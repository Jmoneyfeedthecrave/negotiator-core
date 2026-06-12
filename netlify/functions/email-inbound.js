/**
 * Netlify Function: email-inbound — THIN RECEIVER (v2)
 * POST /api/email-inbound
 *
 * Was: a 768-line synchronous mega-function running two Claude calls (one Opus
 * at 8–10k output tokens) inside a ~26s gateway window — guaranteed mid-flight
 * death on real emails, with Postmark retrying the timed-out webhook and
 * re-triggering partial processing.
 *
 * Now: this function only does the fast work — parse, resolve the thread,
 * persist the raw inbound row — then hands the payload to
 * process-inbound-background (15-minute budget) and ACKs in well under a second.
 *
 * Callers and their contracts:
 *  - Postmark webhook: gets a fast 200 (no retry storms).
 *  - poll-gmail: passes existing_email_id; unchanged.
 *  - UI paste flow: response no longer contains drafted_reply — it returns
 *    { status: 'processing', thread_id, inbound_email_id }. The UI should poll
 *    the emails row until claude_analysis is populated (see pipeline notes).
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://negotiator-core.netlify.app'

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    let payload
    try { payload = JSON.parse(event.body) } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    const {
        From: fromEmail = '',
        To: toEmail = '',
        Subject: subject = '(no subject)',
        TextBody: body = '',
        HtmlBody: htmlBody = '',
        MessageID: messageId = '',
        InReplyTo: inReplyTo = '',
        Headers: headers = [],
        thread_id: existingThreadId = null,
        existing_email_id: existingEmailId = null,
        domain = 'Email Negotiation',
        mode = 'coached',
    } = payload

    const referencesHeader = payload.References || headers.find?.(h => h.Name === 'References')?.Value || ''

    if (!fromEmail && !payload.from_email) {
        return { statusCode: 400, body: JSON.stringify({ error: 'from_email is required' }) }
    }

    const counterpartyEmail = fromEmail || payload.from_email
    const emailBody = body || payload.body || ''
    const emailBodyClean = emailBody || htmlBody.replace(/<[^>]+>/g, '') || ''

    try {
        // ── 1. Resolve thread (fast: a few indexed DB lookups) ──────────────────
        let threadId = existingThreadId

        if (!threadId) {
            // Best match: In-Reply-To / References headers against our sent Message-IDs
            if (inReplyTo || referencesHeader) {
                const msgIds = [inReplyTo, ...referencesHeader.split(/\s+/)].filter(Boolean)
                for (const msgId of msgIds) {
                    const { data: match } = await supabase
                        .from('emails')
                        .select('thread_id')
                        .eq('message_id', msgId)
                        .maybeSingle()
                    if (match?.thread_id) { threadId = match.thread_id; break }
                }
            }

            // Fallback: counterparty + subject within 90-day recency window (DFB-6 guard)
            if (!threadId) {
                const baseSubject = subject.replace(/^(re:|fwd?:)\s*/gi, '').trim()
                const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
                const { data: existing } = await supabase
                    .from('email_threads')
                    .select('id')
                    .eq('counterparty_email', counterpartyEmail)
                    .ilike('subject', `%${baseSubject}%`)
                    .eq('status', 'active')
                    .gte('updated_at', ninetyDaysAgo)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                if (existing) threadId = existing.id
            }

            // New thread
            if (!threadId) {
                const { data: session } = await supabase
                    .from('sessions')
                    .insert({ domain, transcript: [], config_snapshot: { mode } })
                    .select().single()
                const { data: thread } = await supabase
                    .from('email_threads')
                    .insert({ subject, counterparty_email: counterpartyEmail, domain, session_id: session?.id, mode })
                    .select().single()
                threadId = thread.id
            }
        }

        // ── 2. Persist the raw inbound email NOW (analysis attaches later) ──────
        // If poll-gmail pre-inserted the row, reuse it; otherwise insert here so
        // the email is never lost even if background processing fails.
        let inboundEmailId = existingEmailId
        if (!inboundEmailId) {
            const ourEmail = process.env.GMAIL_USER || process.env.FROM_EMAIL
            const { data: savedEmail } = await supabase
                .from('emails')
                .insert({
                    thread_id: threadId,
                    direction: 'inbound',
                    from_email: counterpartyEmail,
                    to_email: toEmail || ourEmail,
                    subject,
                    body: emailBodyClean,
                    message_id: messageId || null,
                    status: 'processing',          // analysis pending
                })
                .select().maybeSingle()
            inboundEmailId = savedEmail?.id
        } else {
            await supabase.from('emails')
                .update({ status: 'processing' })
                .eq('id', inboundEmailId)
        }

        // ── 3. Dispatch heavy processing to the background function ─────────────
        // Background functions ACK with 202 immediately; the await below resolves
        // in well under a second. Attachments ride along in the forwarded payload.
        const dispatch = await fetch(`${SITE_URL}/.netlify/functions/process-inbound-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                thread_id: threadId,
                inbound_email_id: inboundEmailId,
                payload,
            }),
        })

        if (dispatch.status !== 202 && !dispatch.ok) {
            // Mark for retry/attention rather than dropping the email silently.
            await supabase.from('emails')
                .update({ status: 'analysis_failed' })
                .eq('id', inboundEmailId)
            await supabase.from('email_threads')
                .update({ needs_attention: true, attention_reason: 'processing_dispatch_failed', updated_at: new Date().toISOString() })
                .eq('id', threadId)
            throw new Error(`Background dispatch failed: HTTP ${dispatch.status}`)
        }

        // ── 4. Fast ACK ──────────────────────────────────────────────────────────
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'processing',
                thread_id: threadId,
                inbound_email_id: inboundEmailId,
            }),
        }
    } catch (err) {
        console.error('[email-inbound]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
