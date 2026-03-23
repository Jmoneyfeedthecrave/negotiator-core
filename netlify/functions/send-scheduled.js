/**
 * Netlify Scheduled Function: send-scheduled
 * Runs every 15 minutes via Netlify Cron
 * Fetches emails with send_status='scheduled' and scheduled_send_at <= NOW()
 * Delegates sending to the email-send function (which handles Reply-To, threading headers, etc.)
 */

import { getSupabaseAdmin } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

export const handler = async () => {
    const now = new Date().toISOString()

    // Fetch all scheduled emails that are due � use correct schema column names
    const { data: dueEmails, error } = await getDB()
        .from('emails')
        .select('id, thread_id, from_email, to_email, subject, drafted_reply, scheduled_send_at')
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
            // Atomic compare-and-swap: only claim this email if it's still 'scheduled'
            // If another concurrent runner already claimed it, count === 0 and we skip
            const { count } = await getDB()
                .from('emails')
                .update({ send_status: 'sending' })
                .eq('id', email.id)
                .eq('send_status', 'scheduled')  // Only update if still unclaimed
                .select('id', { count: 'exact', head: true })

            if (!count || count === 0) {
                console.log(`[send-scheduled] Email ${email.id} already claimed by another runner � skipping`)
                continue
            }

            // Delegate to email-send which handles Reply-To, threading headers, Gmail SMTP 
            const sendRes = await fetch(`${process.env.URL}/.netlify/functions/email-send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Pass service-level key so requireAuth() in email-send is satisfied
                    'Authorization': `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                },
                body: JSON.stringify({ email_id: email.id }),
            })
            if (!sendRes.ok) {
                const err = await sendRes.json().catch(() => ({}))
                throw new Error(err.error || `email-send returned ${sendRes.status}`)
            }
            results.push({ id: email.id, status: 'sent' })
            console.log(`[send-scheduled] Delegated email ${email.id} to email-send`)
        } catch (err) {
            console.error(`[send-scheduled] Failed to send ${email.id}:`, err.message)
            await getDB().from('emails').update({ send_status: 'failed' }).eq('id', email.id)
            results.push({ id: email.id, status: 'failed', error: err.message })
        }
    }

    return { statusCode: 200, body: JSON.stringify({ sent: results.filter(r => r.status === 'sent').length, results }) }
}
