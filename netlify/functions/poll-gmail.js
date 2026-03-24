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
            // Search unseen emails from the last 48 hours
            const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
            const uids = await client.search({ unseen: true, since })
            log.push(`Found ${uids.length} unseen emails`)

            for (const uid of uids) {
                try {
                    const msg = await client.fetchOne(uid, { envelope: true, source: true })
                    const fromAddr = msg.envelope.from?.[0]?.address?.toLowerCase()
                    if (!fromAddr) continue

                    // Match to a known counterparty thread
                    const matchedThread = threads.find(t =>
                        (t.counterparty_email || '').toLowerCase() === fromAddr
                    )
                    if (!matchedThread) {
                        log.push(`Skip: ${fromAddr} not a known counterparty`)
                        continue
                    }

                    const messageId = msg.envelope.messageId

                    // Skip if already processed
                    const { data: existing } = await supabase
                        .from('emails').select('id').eq('message_id', messageId).single()
                    if (existing) {
                        await client.messageFlagsAdd(uid, ['\\Seen'])
                        log.push(`Skip: ${fromAddr} already processed`)
                        continue
                    }

                    // Extract plain text from raw email source
                    const rawEmail = msg.source ? Buffer.from(msg.source).toString('utf-8') : ''
                    let bodyText = ''
                    if (rawEmail) {
                        const plainMatch = rawEmail.match(/Content-Type: text\/plain[^\n]*\n(?:[^\n]+\n)*\n([\s\S]+?)(?=--|\n\n--|$)/i)
                        if (plainMatch) {
                            bodyText = plainMatch[1].trim()
                        } else {
                            const headerEnd = rawEmail.indexOf('\n\n')
                            bodyText = headerEnd > -1 ? rawEmail.slice(headerEnd + 2).trim() : rawEmail
                        }
                    }
                    if (!bodyText.trim()) { log.push(`Skip: empty body from ${fromAddr}`); continue }

                    log.push(`Processing reply from ${fromAddr}`)

                    const siteUrl = process.env.URL || 'https://negotiator-core.netlify.app'

                    // Fire-and-forget — don't await Claude processing (would timeout)
                    // Mark as read immediately so we don't reprocess
                    await client.messageFlagsAdd(uid, ['\\Seen'])
                    fetch(`${siteUrl}/.netlify/functions/email-inbound`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            From: fromAddr,
                            FromName: msg.envelope.from?.[0]?.name || fromAddr,
                            Subject: msg.envelope.subject || '',
                            TextBody: bodyText,
                            MessageID: messageId,
                            ReplyTo: fromAddr,
                        }),
                    }).catch(err => console.error('[poll-gmail] email-inbound fire error:', err.message))

                    processed++
                    log.push(`✓ Queued reply from ${fromAddr} for processing`)
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
