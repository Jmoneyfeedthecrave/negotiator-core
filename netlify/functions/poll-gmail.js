/**
 * Netlify Function: poll-gmail
 * GET /api/poll-gmail
 * Manually triggers Gmail IMAP polling for inbound replies.
 * Same logic as the send-scheduled cron, but callable on-demand.
 */

import { createClient } from '@supabase/supabase-js'
import { ImapFlow } from 'imapflow'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const GMAIL_USER = process.env.GMAIL_USER || 'jdquist2025@gmail.com'
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD

export const handler = async () => {
    if (!GMAIL_PASS) {
        return { statusCode: 500, body: JSON.stringify({ error: 'GMAIL_APP_PASSWORD not set' }) }
    }

    // Fetch active negotiation threads
    const { data: threads } = await supabase
        .from('email_threads')
        .select('id, counterparty_email, subject, thread_type')
        .not('thread_type', 'is', null)

    if (!threads?.length) {
        return { statusCode: 200, body: JSON.stringify({ processed: 0, message: 'No active threads' }) }
    }

    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
        logger: false,
    })

    let processed = 0
    const log = []

    try {
        await client.connect()
        const lock = await client.getMailboxLock('INBOX')

        try {
            // Scan ALL mail from the last 48 hours — do NOT filter by to: address.
            // Gmail's "Reply" button uses From: not Reply-To:, so counterparty replies
            // may land in the main inbox, not the +negotiator alias.
            // We match by sender against known counterparty emails instead.
            const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
            const uids = await client.search({ since })
            log.push(`Scanning all mail since ${since.toISOString()}: ${uids.length} messages`)

            for (const uid of uids) {
                try {
                    const msg = await client.fetchOne(uid, { envelope: true, source: true })
                    const fromAddr = msg.envelope.from?.[0]?.address?.toLowerCase()
                    if (!fromAddr) continue

                    // Skip emails we ourselves sent
                    if (fromAddr === GMAIL_USER.toLowerCase()) {
                        continue
                    }

                    // Only process if sender is a known counterparty
                    const matchedThread = threads.find(t =>
                        (t.counterparty_email || '').toLowerCase() === fromAddr
                    )
                    if (!matchedThread) {
                        log.push(`Skip: ${fromAddr} not a known counterparty`)
                        continue
                    }

                    // Deduplicate by message_id
                    const messageId = msg.envelope.messageId
                    const { data: existing } = await supabase
                        .from('emails').select('id').eq('message_id', messageId).maybeSingle()
                    if (existing) {
                        log.push(`Skip: ${fromAddr} already processed`)
                        continue
                    }

                    // Extract clean plain text from raw MIME email
                    const rawEmail = msg.source ? Buffer.from(msg.source).toString('utf-8') : ''
                    let bodyText = ''
                    if (rawEmail) {
                        // Step 1: Find the text/plain MIME part (handles CRLF and LF)
                        const plainPartMatch = rawEmail.match(
                            /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\r?\nContent-Type:|$)/i
                        )
                        if (plainPartMatch) {
                            bodyText = plainPartMatch[1]
                        } else {
                            // Fallback: skip all headers (everything before the first blank line)
                            const headerEnd = rawEmail.search(/\r?\n\r?\n/)
                            bodyText = headerEnd > -1 ? rawEmail.slice(headerEnd + 2) : rawEmail
                        }

                        // Step 2: Decode quoted-printable encoding
                        bodyText = bodyText
                            .replace(/=\r?\n/g, '')                                             // soft line breaks
                            .replace(/=[0-9A-Fa-f]{2}/g, m => {
                                try { return decodeURIComponent('%' + m.slice(1)) }
                                catch { return m }
                            })

                        // Step 3: Strip the quoted reply thread
                        // Stop at "On ... wrote:" pattern
                        const threadIdx = bodyText.search(/\r?\nOn .+wrote:\s*\r?\n/s)
                        if (threadIdx > -1) bodyText = bodyText.slice(0, threadIdx)

                        // Also stop at the first line starting with > (inline quote)
                        const lines = bodyText.split(/\r?\n/)
                        const cleanLines = []
                        for (const line of lines) {
                            if (line.trimStart().startsWith('>')) break
                            cleanLines.push(line)
                        }
                        bodyText = cleanLines.join('\n').trim()
                    }
                    if (!bodyText.trim()) { log.push(`Skip: empty body from ${fromAddr}`); continue }

                    // Extract In-Reply-To header so email-inbound can match to the correct thread
                    const inReplyToMatch = rawEmail.match(/^In-Reply-To:\s*(.+)$/im)
                    const referencesMatch = rawEmail.match(/^References:\s*(.+)$/im)
                    const references = referencesMatch ? referencesMatch[1].trim() : ''

                    log.push(`Processing reply from ${fromAddr}${inReplyTo ? ` (re: ${inReplyTo.slice(0,40)})` : ''}`)

                    // ── STEP 1: Resolve best thread from In-Reply-To / References ──────────
                    let threadId = matchedThread.id  // fallback: use the matched thread directly
                    const msgIdsToCheck = [inReplyTo, ...references.split(/\s+/)].filter(Boolean)
                    for (const mid of msgIdsToCheck) {
                        const { data: threadMatch } = await supabase
                            .from('emails').select('thread_id').eq('message_id', mid).maybeSingle()
                        if (threadMatch?.thread_id) { threadId = threadMatch.thread_id; break }
                    }

                    // ── STEP 2: Pre-insert inbound email immediately ──────────────────────
                    // Makes the reply visible in ARCHI right away.
                    // Claude analysis enriches it async in the background.
                    const { data: savedEmail } = await supabase
                        .from('emails')
                        .insert({
                            thread_id: threadId,
                            direction: 'inbound',
                            from_email: fromAddr,
                            to_email: GMAIL_USER,
                            subject: msg.envelope.subject || '',
                            body: bodyText,
                            message_id: messageId || null,
                            status: 'processing',
                            send_status: 'scheduled',
                        })
                        .select('id').single()

                    if (!savedEmail?.id) {
                        log.push(`DB insert failed for ${fromAddr}`)
                        continue
                    }

                    // Update thread timestamp so it surfaces in the UI
                    await supabase.from('email_threads')
                        .update({ updated_at: new Date().toISOString() })
                        .eq('id', threadId)

                    const siteUrl = process.env.URL || 'https://negotiator-core.netlify.app'

                    // ── STEP 3: Mark as read then fire-and-forget Claude analysis ─────────
                    await client.messageFlagsAdd(uid, ['\\Seen'])
                    fetch(`${siteUrl}/.netlify/functions/email-inbound-background`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            From: fromAddr,
                            FromName: msg.envelope.from?.[0]?.name || fromAddr,
                            Subject: msg.envelope.subject || '',
                            TextBody: bodyText,
                            MessageID: messageId,
                            InReplyTo: inReplyTo,
                            References: references,
                            ReplyTo: fromAddr,
                            // Pass the already-saved email id so background can update in-place
                            email_id: savedEmail.id,
                            thread_id: threadId,
                        }),
                    }).catch(err => console.error('[poll-gmail] email-inbound fire error:', err.message))

                    processed++
                    log.push(`✓ Saved reply from ${fromAddr} + queued Claude analysis`)
                } catch (msgErr) {
                    log.push(`Error on uid ${uid}: ${msgErr.message}`)
                }
            }
        } finally {
            lock.release()
        }
        await client.logout()
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message, log }) }
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed, log }),
    }
}
