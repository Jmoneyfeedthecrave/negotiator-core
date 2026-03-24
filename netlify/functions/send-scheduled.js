/**
 * Netlify Scheduled Function: send-scheduled
 * Runs every 15 minutes via Netlify Cron
 *
 * Does TWO jobs each run:
 *  1. Send any scheduled reply emails via Gmail SMTP
 *  2. Poll Gmail inbox for new replies from counterparties, process via negotiate
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const GMAIL_USER = process.env.GMAIL_USER || 'jdquist2025@gmail.com'
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD

function getTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
}

// ─── Job 1: Send scheduled emails via Gmail SMTP ────────────────────────────
async function processDueEmails() {
    const now = new Date().toISOString()
    const { data: dueEmails, error } = await supabase
        .from('emails')
        .select('id, thread_id, from_address, to_address, subject, body, scheduled_send_at, message_id')
        .eq('send_status', 'scheduled')
        .lte('scheduled_send_at', now)
        .limit(50)

    if (error) { console.error('[send-scheduled] fetch error:', error.message); return 0 }
    if (!dueEmails?.length) { console.log('[send-scheduled] No emails due'); return 0 }

    const transporter = getTransporter()
    let sent = 0
    for (const email of dueEmails) {
        try {
            const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
            const info = await transporter.sendMail({
                from: `"AI Negotiator" <${GMAIL_USER}>`,
                to: email.to_address,
                subject,
                text: email.body,
                replyTo: GMAIL_USER,
                ...(email.message_id && {
                    headers: { 'In-Reply-To': email.message_id, 'References': email.message_id }
                }),
            })
            await supabase.from('emails')
                .update({ send_status: 'sent', sent_at: new Date().toISOString(), message_id: info.messageId })
                .eq('id', email.id)
            await supabase.from('email_threads').update({ updated_at: new Date().toISOString() }).eq('id', email.thread_id)
            console.log(`[send-scheduled] Sent ${email.id}`)
            sent++
        } catch (err) {
            console.error(`[send-scheduled] Failed ${email.id}:`, err.message)
            await supabase.from('emails').update({ send_status: 'failed' }).eq('id', email.id)
        }
    }
    return sent
}

// ─── Job 2: Poll Gmail inbox for inbound replies ─────────────────────────────
async function pollGmailInbox() {
    if (!GMAIL_PASS) { console.warn('[gmail-poll] No GMAIL_APP_PASSWORD set'); return 0 }

    // Fetch all active thread counterparty emails so we can match replies
    const { data: threads } = await supabase
        .from('email_threads')
        .select('id, counterparty_email, subject, thread_type')
        .not('thread_type', 'is', null)

    if (!threads?.length) return 0

    const counterpartyEmails = new Set(threads.map(t => t.to_email || t.counterparty_email).filter(Boolean))

    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
        logger: false,
    })

    let processed = 0
    try {
        await client.connect()
        const lock = await client.getMailboxLock('INBOX')
        try {
            // Search for unseen emails from any of our counterparties
            const messages = await client.search({ unseen: true, since: new Date(Date.now() - 24 * 60 * 60 * 1000) })

            for (const uid of messages) {
                try {
                    const msg = await client.fetchOne(uid, {
                        source: false,
                        envelope: true,
                        bodyParts: ['TEXT'],
                    })

                    const fromAddr = msg.envelope.from?.[0]?.address?.toLowerCase()
                    if (!fromAddr) continue

                    // Only process if it's from a known counterparty
                    const matchedThread = threads.find(t =>
                        (t.counterparty_email || '').toLowerCase() === fromAddr
                    )
                    if (!matchedThread) continue

                    // Get the email body
                    const bodyPart = msg.bodyParts?.get('TEXT')
                    const bodyText = bodyPart ? Buffer.from(bodyPart).toString('utf-8') : ''
                    if (!bodyText.trim()) continue

                    const subject = msg.envelope.subject || ''
                    const messageId = msg.envelope.messageId

                    // Check if we've already processed this message
                    const { data: existing } = await supabase
                        .from('emails')
                        .select('id')
                        .eq('message_id', messageId)
                        .single()

                    if (existing) {
                        // Already in DB — mark as read and skip
                        await client.messageFlagsAdd(uid, ['\\Seen'])
                        continue
                    }

                    console.log(`[gmail-poll] Processing reply from ${fromAddr} for thread ${matchedThread.id}`)

                    // Forward to email-inbound for processing (runs Claude negotiation engine)
                    const inboundPayload = {
                        From: fromAddr,
                        FromName: msg.envelope.from?.[0]?.name || fromAddr,
                        Subject: subject,
                        TextBody: bodyText,
                        MessageID: messageId,
                        ReplyTo: fromAddr,
                    }

                    const siteUrl = process.env.URL || 'https://negotiator-core.netlify.app'
                    const resp = await fetch(`${siteUrl}/.netlify/functions/email-inbound-background`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(inboundPayload),
                    })

                    if (resp.ok) {
                        // Mark as read in Gmail so we don't reprocess
                        await client.messageFlagsAdd(uid, ['\\Seen'])
                        processed++
                        console.log(`[gmail-poll] ✓ Processed reply from ${fromAddr}`)
                    } else {
                        const errText = await resp.text()
                        console.error(`[gmail-poll] email-inbound returned ${resp.status}:`, errText)
                    }
                } catch (msgErr) {
                    console.error(`[gmail-poll] Error processing uid ${uid}:`, msgErr.message)
                }
            }
        } finally {
            lock.release()
        }
        await client.logout()
    } catch (err) {
        console.error('[gmail-poll] IMAP error:', err.message)
    }

    return processed
}

// ─── Main handler ────────────────────────────────────────────────────────────
export const handler = async () => {
    console.log('[send-scheduled] Starting cron run')

    const [sent, polled] = await Promise.all([
        processDueEmails(),
        pollGmailInbox(),
    ])

    console.log(`[send-scheduled] Done — sent: ${sent}, inbound processed: ${polled}`)
    return {
        statusCode: 200,
        body: JSON.stringify({ sent, inbound_processed: polled })
    }
}
