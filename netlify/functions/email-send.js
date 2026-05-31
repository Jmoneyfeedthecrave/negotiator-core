/**
 * Netlify Function: email-send
 * POST /api/email-send
 * Body: { email_id: string, custom_reply?: string }
 * Sends reply via Gmail SMTP with Reply-To = our Gmail, so the counterparty's
 * reply lands back in our inbox where poll-gmail ingests it. Used for coached/approved sends.
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

        // Gmail-only loop: send from our Gmail with Reply-To = our Gmail so the counterparty's
        // reply lands back in the inbox poll-gmail watches. Thread against THEIR last message-id
        // (stored as in_reply_to on this outbound row) so their client groups the conversation.
        const parentMessageId = email.in_reply_to || email.message_id

        const transporter = getTransporter()
        const info = await transporter.sendMail({
            from: `"AI Negotiator" <${ourEmail}>`,
            to: toEmail,
            subject,
            text: replyText,
            replyTo: ourEmail,
            ...(parentMessageId && {
                headers: {
                    'In-Reply-To': parentMessageId,
                    'References': parentMessageId,
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
            body: JSON.stringify({ success: true, sent_to: toEmail, reply_to: ourEmail }),
        }
    } catch (err) {
        console.error('[email-send]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}

