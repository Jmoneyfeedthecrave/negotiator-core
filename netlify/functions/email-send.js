/**
 * Netlify Function: email-send
 * POST /api/email-send
 * Body: { email_id: string, custom_reply?: string }
 * Sends reply via Gmail SMTP. Sets Reply-To to Postmark inbound so
 * counterparty replies automatically route back to our webhook.
 */

import { getSupabaseAdmin } from './fnUtils.js'
import nodemailer from 'nodemailer'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

function getTransporter() {
    const user = process.env.GMAIL_USER
    if (!user) throw new Error('GMAIL_USER environment variable is not set')
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
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
        const { data: email, error: emailErr } = await getDB()
            .from('emails')
            .select('*, email_threads(*)')
            .eq('id', email_id)
            .single()

        if (emailErr || !email) throw new Error('Email not found')
        if (email.status === 'sent') return { statusCode: 200, body: JSON.stringify({ message: 'Already sent' }) }

        const replyText = custom_reply || email.drafted_reply
        if (!replyText) throw new Error('No reply text available')

        const thread = email.email_threads
        const ourEmail = process.env.GMAIL_USER
        if (!ourEmail) throw new Error('GMAIL_USER environment variable is not set')

        // For INBOUND email replies: the counterparty wrote to us, so from_email IS the counterparty.
        // to_email stores the Postmark inbound hash (e.g. 45d9ccde...@inbound.postmarkapp.com) — NEVER send there.
        // For OUTBOUND drafts (direction='outbound'): to_email is the intended recipient.
        let toEmail
        if (email.direction === 'inbound') {
            // Always reply to whoever wrote to us
            toEmail = email.from_email
        } else {
            // Outbound draft — prefer explicit to_email if it's not our own address
            toEmail = (email.to_email && email.to_email !== ourEmail && !email.to_email.includes('@inbound'))
                ? email.to_email
                : thread?.counterparty_email
        }

        if (!toEmail || toEmail === ourEmail || toEmail.includes('@inbound')) {
            throw new Error(`Invalid or missing recipient: ${toEmail}. Cannot send email to self or Postmark hash address.`)
        }


        const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || thread?.subject}`

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

        // Update the existing email record as sent — do NOT insert a new record (would duplicate thread history)
        await getDB().from('emails').update({
            status: 'sent',
            send_status: 'sent',
            sent_at: new Date().toISOString(),
            message_id: sentMessageId,
        }).eq('id', email_id)

        await getDB().from('email_threads').update({ updated_at: new Date().toISOString() }).eq('id', email.thread_id)

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

