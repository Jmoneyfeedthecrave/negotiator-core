/**
 * Netlify Scheduled Function: send-scheduled
 * Runs on a cron (see netlify.toml). Two jobs, in order:
 *   1. INGEST  — trigger poll-gmail to pull any new counterparty replies into the DB.
 *   2. SEND     — find outbound replies whose scheduled_send_at has passed and send them.
 *
 * Gmail-only architecture: everything sends through Gmail SMTP (same transport as email-send),
 * Reply-To is our Gmail, and replies are ingested by poll-gmail. No Postmark anywhere.
 *
 * Double-send safety: emails are claimed atomically by flipping send_status 'scheduled' -> 'sending'
 * before dispatch, so two overlapping cron runs can't grab the same row.
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

function resolveSiteUrl() {
    return process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://negotiator-core.netlify.app'
}

function getTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER || process.env.FROM_EMAIL,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    })
}

// ── Job 1: pull new replies in. poll-gmail pre-inserts each reply and queues Claude analysis. ──
async function ingestReplies() {
    try {
        const res = await fetch(`${resolveSiteUrl()}/.netlify/functions/poll-gmail`, { method: 'GET' })
        const data = await res.json().catch(() => ({}))
        console.log(`[send-scheduled] poll-gmail processed=${data.processed ?? '?'}`)
    } catch (err) {
        console.error('[send-scheduled] poll-gmail trigger failed:', err.message)
    }
}

export const handler = async () => {
    // 1. Ingest first so a reply that arrived this cycle can also be drafted this cycle
    //    (the actual send of that draft happens on the next cycle once analysis completes).
    await ingestReplies()

    const now = new Date().toISOString()
    const runId = `run_${Date.now()}`

    // 2. Claim due outbound emails atomically: 'scheduled' -> 'sending'. Only rows whose
    //    scheduled_send_at has passed are eligible. Coached drafts sit at 'pending_approval'
    //    and are never claimed here — they go out via email-send when the human approves.
    const { data: claimed, error: claimError } = await supabase
        .from('emails')
        .update({ send_status: 'sending', claimed_by: runId })
        .eq('send_status', 'scheduled')
        .eq('direction', 'outbound')
        .lte('scheduled_send_at', now)
        .select('id, thread_id, from_email, to_email, subject, body, drafted_reply, in_reply_to')

    if (claimError) {
        console.error('[send-scheduled] claim error:', claimError.message)
        return { statusCode: 500, body: JSON.stringify({ error: claimError.message }) }
    }

    if (!claimed || claimed.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ sent: 0 }) }
    }

    console.log(`[send-scheduled] ${runId} claimed ${claimed.length} emails`)

    const ourEmail = process.env.GMAIL_USER || process.env.FROM_EMAIL
    const transporter = getTransporter()
    const results = []

    for (const email of claimed) {
        try {
            const replyText = email.drafted_reply || email.body
            if (!replyText) throw new Error('No reply text to send')

            const parentMessageId = email.in_reply_to // counterparty's last message-id, for threading
            const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || ''}`

            const info = await transporter.sendMail({
                from: `"AI Negotiator" <${ourEmail}>`,
                to: email.to_email,
                subject,
                text: replyText,
                replyTo: ourEmail,
                ...(parentMessageId && {
                    headers: {
                        'In-Reply-To': parentMessageId,
                        'References': parentMessageId,
                    },
                }),
            })

            await supabase
                .from('emails')
                .update({
                    send_status: 'sent',
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    message_id: info.messageId || null, // our outbound id — matches their next reply to this thread
                    body: replyText,                    // materialise body once actually sent
                })
                .eq('id', email.id)

            await supabase.from('email_threads')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', email.thread_id)

            results.push({ id: email.id, status: 'sent' })
            console.log(`[send-scheduled] sent email ${email.id}`)
        } catch (err) {
            console.error(`[send-scheduled] failed to send ${email.id}:`, err.message)
            // Release the claim so a later run can retry instead of leaving it stuck in 'sending'.
            await supabase
                .from('emails')
                .update({ send_status: 'scheduled', claimed_by: null })
                .eq('id', email.id)
            results.push({ id: email.id, status: 'failed', error: err.message })
        }
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sent: results.filter(r => r.status === 'sent').length, results }),
    }
}
