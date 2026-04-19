/**
 * claudeClient.js
 * Client-side wrappers for all Netlify Function API calls.
 * These are the only entry points from the React frontend to the backend.
 */

export async function runNegotiationTurn({ sessionId, counterpartyMessage, mode, concessionFlag }) {
    const response = await fetch('/api/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // UI-1: Pass concession_flag through so the backend can use it in the system prompt
        body: JSON.stringify({
            session_id: sessionId,
            counterparty_message: counterpartyMessage,
            mode,
            concession_flag: concessionFlag || { warning: false },
        }),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] negotiate failed: ${err.error || response.statusText}`)
    }
    return response.json()
}

export async function initSession({ domain, configId, perspective = 'seller' }) {
    const response = await fetch('/api/init-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, config_id: configId, perspective }),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] initSession failed: ${err.error || response.statusText}`)
    }
    return response.json()
}

export async function endSession({ sessionId, outcome, finalValue }) {
    const response = await fetch('/api/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, outcome, final_value: finalValue }),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] endSession failed: ${err.error || response.statusText}`)
    }
    return response.json()
}

export async function initiateNegotiation(payload) {
    const response = await fetch('/api/initiate-negotiation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] initiateNegotiation failed: ${err.error || response.statusText}`)
    }
    return response.json()
}

export async function sendEmail({ emailId, customReply }) {
    const response = await fetch('/api/email-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_id: emailId, custom_reply: customReply }),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] sendEmail failed: ${err.error || response.statusText}`)
    }
    return response.json()
}

export async function reflectOnThread({ threadId, outcome, dealValue, notes }) {
    const response = await fetch('/api/negotiation-reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, outcome, deal_value: dealValue, notes }),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] reflect failed: ${err.error || response.statusText}`)
    }
    return response.json()
}
