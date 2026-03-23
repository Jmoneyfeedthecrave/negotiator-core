import { apiFetch } from './apiFetch.js'

export async function runNegotiationTurn({ sessionId, counterpartyMessage, mode, concessionFlag }) {
    return apiFetch('/api/negotiate', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, counterparty_message: counterpartyMessage, mode, concession_flag: concessionFlag }),
    })
}

export async function initSession({ domain, configId }) {
    return apiFetch('/api/init-session', {
        method: 'POST',
        body: JSON.stringify({ domain, config_id: configId }),
    })
}

export async function endSession({ sessionId, outcome, finalValue }) {
    return apiFetch('/api/end-session', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, outcome, final_value: finalValue }),
    })
}
