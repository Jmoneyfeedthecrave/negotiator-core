/**
 * Netlify Function: email-send
 * POST /api/email-send
 * Body: { email_id: string, custom_reply?: string }
 * Sends reply via Gmail SMTP. Sets Reply-To to Postmark inbound so
 * counterparty replies automatically route back to our webhook.
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)

function getTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER || process.env.FROM_EMAIL,
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
            .maybeSingle()

        if (emailErr || !email) throw new Error('Email not found')
        if (email.status === 'sent') return { statusCode: 200, body: JSON.stringify({ message: 'Already sent' }) }

        const replyText = custom_reply || email.drafted_reply
        if (!replyText) throw new Error('No reply text available')

        const thread = email.email_threads
        // For outbound rows: to_email is the counterparty. For inbound rows: from_email is the counterparty.
        const toEmail = email.direction === 'outbound' ? email.to_email : (email.from_email || thread?.counterparty_email)
        const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || thread?.subject}`
        const ourEmail = process.env.GMAIL_USER || process.env.FROM_EMAIL

        // Postmark inbound address — counterparty replies go here automatically
        const postmarkInbound = process.env.POSTMARK_INBOUND_ADDRESS

        const transporter = getTransporter()
        const info = await transporter.sendMail({
            from: `"AI Negotiator" <${ourEmail}>`,
            to: toEmail,
            subject,
            text: replyText,
            // KEY: Reply-To routes counterparty's reply to Postmark → our webhook
            ...(postmarkInbound && { replyTo: postmarkInbound }),
            // Email threading headers so email clients show a proper thread
            ...(email.message_id && {
                headers: {
                    'In-Reply-To': email.message_id,
                    'References': email.message_id,
                }
            }),
        })

        const sentMessageId = info.messageId

        // Mark this outbound row as sent (it was already created by email-inbound or initiate-negotiation)
        await supabase.from('emails').update({
            status: 'sent',
            send_status: 'sent',
            body: replyText,          // populate the body now that it's confirmed sent
            sent_at: new Date().toISOString(),
            message_id: sentMessageId, // store our outbound Message-ID for future reply threading
        }).eq('id', email_id)

        await supabase.from('email_threads')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', email.thread_id)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, sent_to: toEmail, reply_to: postmarkInbound || '(not set)' }),
        }
    } catch (err) {
        console.error('[email-send]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}

