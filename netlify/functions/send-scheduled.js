/**
 * Netlify Scheduled Function: send-scheduled
 * Runs every 15 minutes via Netlify Cron
 * Checks for emails with send_status='scheduled' and scheduled_send_at <= NOW()
 * Sends them via Postmark and marks them as sent.
 *
 * ARCH-4: Uses optimistic row-locking via a status transition to 'sending'
 * before dispatch so concurrent cron runs don't double-send the same email.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)
const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN

async function sendViaPostmark(email) {
    const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN,
        },
        body: JSON.stringify({
            From: email.from_email || process.env.POSTMARK_FROM_EMAIL || process.env.GMAIL_USER,
            To: email.to_email,
            Subject: email.subject,
            TextBody: email.drafted_reply || email.body,
            ReplyTo: process.env.POSTMARK_INBOUND_ADDRESS || email.from_email,
            // Preserve email threading
            ...(email.in_reply_to && {
                Headers: [
                    { Name: 'In-Reply-To', Value: email.in_reply_to },
                    { Name: 'References', Value: email.in_reply_to },
                ]
            }),
        })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Postmark error: ${data.Message || res.status}`)
    return data
}

export const handler = async () => {
    const now = new Date().toISOString()
    const runId = `run_${Date.now()}`

    // ARCH-4: Claim emails atomically by transitioning status 'scheduled' → 'sending'
    // This prevents two concurrent cron runs from processing the same rows.
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
        console.log('[send-scheduled] No emails due')
        return { statusCode: 200, body: JSON.stringify({ sent: 0 }) }
    }

    console.log(`[send-scheduled] ${runId} claimed ${claimed.length} emails`)

    const results = []
    for (const email of claimed) {
        try {
            const postmarkResult = await sendViaPostmark(email)
            await supabase
                .from('emails')
                .update({
                    send_status: 'sent',
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    message_id: postmarkResult.MessageID || null,
                    body: email.drafted_reply || email.body,  // materialise body once sent
                })
                .eq('id', email.id)

            await supabase.from('email_threads')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', email.thread_id)

            results.push({ id: email.id, status: 'sent' })
            console.log(`[send-scheduled] Sent email ${email.id}`)
        } catch (err) {
            console.error(`[send-scheduled] Failed to send ${email.id}:`, err.message)
            await supabase
                .from('emails')
                .update({ send_status: 'failed', claimed_by: null })
                .eq('id', email.id)
            results.push({ id: email.id, status: 'failed', error: err.message })
        }
    }

    return { statusCode: 200, body: JSON.stringify({ sent: results.filter(r => r.status === 'sent').length, results }) }
}
