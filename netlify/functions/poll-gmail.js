/**
 * Netlify Function: poll-gmail
 * GET /api/poll-gmail
 *
 * Polls Gmail IMAP for inbound replies from active negotiation counterparties.
 * Pre-saves reply to DB immediately so the UI shows it right away, then
 * fires email-inbound (fire-and-forget) to run Claude analysis in the background.
 *
 * Called manually by the UI "Refresh" or automatically by send-scheduled cron.
 */

import { ImapFlow } from 'imapflow'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

const GMAIL_USER = process.env.GMAIL_USER || 'jdquist2025@gmail.com'
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD

export const handler = async () => {
    if (!GMAIL_PASS) {
        return { statusCode: 500, body: JSON.stringify({ error: 'GMAIL_APP_PASSWORD not set' }) }
    }

    // Fetch all active threads that have a counterparty email
    const { data: threads } = await supabase
        .from('email_threads')
        .select('id, counterparty_email, subject')
        .not('counterparty_email', 'is', null)

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
            // Scan last 48 hours of mail
            const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
            const uids = await client.search({ since })
            log.push(`Scanning all mail since ${since.toISOString()}: ${uids.length} messages`)

            for (const uid of uids) {
                try {
                    const msg = await client.fetchOne(uid, { envelope: true, source: true })
                    const fromAddr = msg.envelope.from?.[0]?.address?.toLowerCase()
                    if (!fromAddr) continue

                    // Skip emails we sent
                    if (fromAddr === GMAIL_USER.toLowerCase()) continue

                    // Only process replies from known counterparties
                    const matchedThread = threads.find(t =>
                        (t.counterparty_email || '').toLowerCase() === fromAddr
                    )
                    if (!matchedThread) {
                        log.push(`Skip: ${fromAddr} not a known counterparty`)
                        continue
                    }

                    // Deduplicate by message_id
                    const messageId = msg.envelope.messageId
                    if (messageId) {
                        const { data: existing } = await supabase
                            .from('emails')
                            .select('id')
                            .eq('message_id', messageId)
                            .maybeSingle()
                        if (existing) {
                            log.push(`Skip: ${messageId} already processed`)
                            continue
                        }
                    }

                    // ── Parse clean plain text from raw MIME source ──────────────
                    const rawEmail = msg.source ? Buffer.from(msg.source).toString('utf-8') : ''
                    let bodyText = ''
                    if (rawEmail) {
                        // Extract text/plain MIME part
                        const plainMatch = rawEmail.match(
                            /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)(?=\r?\n--|$)/i
                        )
                        if (plainMatch) {
                            bodyText = plainMatch[1]
                        } else {
                            const headerEnd = rawEmail.search(/\r?\n\r?\n/)
                            bodyText = headerEnd > -1 ? rawEmail.slice(headerEnd + 2) : rawEmail
                        }

                        // Decode quoted-printable encoding
                        bodyText = bodyText
                            .replace(/=\r?\n/g, '')
                            .replace(/=[0-9A-Fa-f]{2}/g, m => {
                                try { return decodeURIComponent('%' + m.slice(1)) } catch { return m }
                            })

                        // Strip quoted reply thread ("On ... wrote:")
                        const threadIdx = bodyText.search(/\r?\nOn .+wrote:\s*\r?\n/s)
                        if (threadIdx > -1) bodyText = bodyText.slice(0, threadIdx)

                        // Strip lines starting with > (inline quote)
                        const lines = bodyText.split(/\r?\n/)
                        const cleanLines = []
                        for (const line of lines) {
                            if (line.trimStart().startsWith('>')) break
                            cleanLines.push(line)
                        }
                        bodyText = cleanLines.join('\n').trim()
                    }

                    if (!bodyText.trim()) {
                        log.push(`Skip: empty body from ${fromAddr}`)
                        continue
                    }

                    // Extract threading headers
                    const inReplyToMatch = rawEmail.match(/^In-Reply-To:\s*(.+)$/im)
                    const inReplyTo = inReplyToMatch ? inReplyToMatch[1].trim() : ''
                    const referencesMatch = rawEmail.match(/^References:\s*(.+)$/im)
                    const references = referencesMatch ? referencesMatch[1].trim() : ''

                    log.push(`Processing reply from ${fromAddr} → thread ${matchedThread.id}`)

                    // ── Pre-insert inbound email so it shows up in UI immediately ──
                    const { data: savedEmail } = await supabase
                        .from('emails')
                        .insert({
                            thread_id: matchedThread.id,
                            direction: 'inbound',
                            from_email: fromAddr,
                            to_email: GMAIL_USER,
                            subject: msg.envelope.subject || '',
                            body: bodyText,
                            message_id: messageId || null,
                            status: 'received',
                            send_status: 'received',
                        })
                        .select('id')
                        .single()

                    if (!savedEmail?.id) {
                        log.push(`DB insert failed for ${fromAddr}`)
                        continue
                    }

                    // Update thread timestamp so it surfaces in the UI
                    await supabase
                        .from('email_threads')
                        .update({ updated_at: new Date().toISOString() })
                        .eq('id', matchedThread.id)

                    // Mark as read in Gmail
                    await client.messageFlagsAdd(uid, ['\\Seen'])

                    // ── Fire-and-forget Claude analysis ──────────────────────────
                    const siteUrl = process.env.URL || 'https://negotiator-core.netlify.app'
                    fetch(`${siteUrl}/.netlify/functions/email-inbound`, {
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
                            thread_id: matchedThread.id,
                            existing_email_id: savedEmail.id,
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
