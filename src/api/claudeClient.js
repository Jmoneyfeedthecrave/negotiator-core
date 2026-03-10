export async function runNegotiationTurn({ sessionId, counterpartyMessage, mode }) {
    const response = await fetch('/api/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, counterparty_message: counterpartyMessage, mode }),
    })
    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`[claudeClient] negotiate failed: ${err.error || response.statusText}`)
    }
    return response.json()
}

export async function initSession({ domain, configId }) {
    const response = await fetch('/api/init-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, config_id: configId }),
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
