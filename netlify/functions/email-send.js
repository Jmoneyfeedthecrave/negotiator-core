/**
 * Netlify Function: email-send
 * POST /api/email-send
 * Body: { email_id: string, custom_reply?: string }
 * Sends reply via Gmail SMTP. Sets Reply-To to Postmark inbound so
 * counterparty replies automatically route back to our webhook.
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

function getTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER || 'jdquist2025@gmail.com',
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    })
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    let body
    try { body = JSON.parse(event.body) } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    const { email_id, custom_reply } = body
    if (!email_id) return { statusCode: 400, body: JSON.stringify({ error: 'email_id required' }) }

    try {
        const { data: email, error: emailErr } = await supabase
            .from('emails')
            .select('*, email_threads(*)')
            .eq('id', email_id)
            .single()

        if (emailErr || !email) throw new Error('Email not found')
        if (email.status === 'sent') return { statusCode: 200, body: JSON.stringify({ message: 'Already sent' }) }

        const replyText = custom_reply || email.drafted_reply
        if (!replyText) throw new Error('No reply text available')

        const thread = email.email_threads
        const toEmail = email.from_email || thread?.counterparty_email
        const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || thread?.subject}`
        const ourEmail = process.env.GMAIL_USER || 'jdquist2025@gmail.com'

        const transporter = getTransporter()
        const info = await transporter.sendMail({
            from: `"AI Negotiator" <${ourEmail}>`,
            to: toEmail,
            subject,
            text: replyText,
            // Reply-To routes counterparty replies back to our Gmail inbox (polled by send-scheduled)
            replyTo: ourEmail,
            // Email threading headers so email clients show a proper thread
            ...(email.message_id && {
                headers: {
                    'In-Reply-To': email.message_id,
                    'References': email.message_id,
                }
            }),
        })

        const sentMessageId = info.messageId

        // Update the existing draft record in-place — do NOT insert a new record
        await supabase.from('emails').update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            message_id: sentMessageId,
            body: replyText,
            from_email: ourEmail,
            to_email: toEmail,
            subject,
        }).eq('id', email_id)
        await supabase.from('email_threads').update({ updated_at: new Date().toISOString() }).eq('id', email.thread_id)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, sent_to: toEmail, reply_to: ourEmail }),
        }
    } catch (err) {
        console.error('[email-send]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}

