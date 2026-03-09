/**
 * claudeClient.js
 * Wraps the /api/negotiate Netlify function call.
 * All Claude API keys stay server-side — this is a browser-safe wrapper.
 */

/**
 * Run one negotiation turn via the Netlify function.
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.counterpartyMessage
 * @param {'coached'|'autonomous'} params.mode
 * @returns {Promise<object>} structured turn result from Claude
 */
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

/**
 * Initialize a new negotiation session.
 * @param {object} params
 * @param {string} params.domain
 * @param {string} params.configId
 * @returns {Promise<object>} { session_id, world_model_id }
 */
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

/**
 * End a session and record the outcome.
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.outcome
 * @param {number} params.finalValue
 * @returns {Promise<object>}
 */
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
