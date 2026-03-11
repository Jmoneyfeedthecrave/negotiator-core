/**
 * Netlify Scheduled Function: send-scheduled
 * Runs every 15 minutes via Netlify Cron
 * Checks for emails with send_status='scheduled' and scheduled_send_at <= NOW()
 * Sends them via Postmark and marks them as sent
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
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
            From: email.from_address || process.env.POSTMARK_FROM_EMAIL,
            To: email.to_address,
            Subject: email.subject,
            TextBody: email.body,
            ReplyTo: email.from_address,
        })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Postmark error: ${data.Message || res.status}`)
    return data
}

export const handler = async () => {
    const now = new Date().toISOString()

    // Fetch all scheduled emails that are due
    const { data: dueEmails, error } = await supabase
        .from('emails')
        .select('id, thread_id, from_address, to_address, subject, body, scheduled_send_at')
        .eq('send_status', 'scheduled')
        .lte('scheduled_send_at', now)
        .limit(50)

    if (error) {
        console.error('[send-scheduled] fetch error:', error.message)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }

    if (!dueEmails || dueEmails.length === 0) {
        console.log('[send-scheduled] No emails due')
        return { statusCode: 200, body: JSON.stringify({ sent: 0 }) }
    }

    console.log(`[send-scheduled] Processing ${dueEmails.length} emails`)

    const results = []
    for (const email of dueEmails) {
        try {
            await sendViaPostmark(email)
            await supabase
                .from('emails')
                .update({ send_status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', email.id)
            results.push({ id: email.id, status: 'sent' })
            console.log(`[send-scheduled] Sent email ${email.id}`)
        } catch (err) {
            console.error(`[send-scheduled] Failed to send ${email.id}:`, err.message)
            await supabase
                .from('emails')
                .update({ send_status: 'failed' })
                .eq('id', email.id)
            results.push({ id: email.id, status: 'failed', error: err.message })
        }
    }

    return { statusCode: 200, body: JSON.stringify({ sent: results.filter(r => r.status === 'sent').length, results }) }
}
