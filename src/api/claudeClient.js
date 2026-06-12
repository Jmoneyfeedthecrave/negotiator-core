/**
 * src/lib/claudeClient.js — REPLACEMENT
 *
 * Drop-in replacement for the existing claudeClient module.
 * (Your bundle's error prefixes show the old functions live in a module
 * logging as "[claudeClient]" — replace that file with this one. If your
 * exported function names differ, keep your names and copy the bodies.)
 *
 * Changes:
 *  - negotiate() now dispatches to /api/negotiate-background (immediate 202)
 *    and polls /api/turn-status until the turn completes. Same resolved
 *    response shape as before, so the console component's handling of
 *    turn_number / technique_detected / natural_language_response / type
 *    === 'batna_breach' all keeps working unchanged.
 *  - initSession() now transmits BATNA value, BATNA description, and max
 *    turns (previously collected in the UI but silently dropped).
 *  - Optional onStatus callback lets the UI log progress while polling.
 */

const POLL_INTERVAL_MS = 2500
const POLL_TIMEOUT_MS = 180000 // 3 min ceiling; sonnet turns typically land in 15–45s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeTurnId() {
    // crypto.randomUUID is available in all modern browsers (secure contexts)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    // Fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

export async function runNegotiationTurn({
    sessionId,
    counterpartyMessage,
    mode,
    concessionFlag,
    onStatus, // optional: (statusString) => void
}) {
    const turnId = makeTurnId()

    // 1. Dispatch — Netlify background functions return 202 immediately.
    const dispatch = await fetch('/api/negotiate-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            turn_id: turnId,
            session_id: sessionId,
            counterparty_message: counterpartyMessage,
            mode,
            concession_flag: concessionFlag || { warning: false },
        }),
    })

    if (dispatch.status !== 202 && !dispatch.ok) {
        const d = await dispatch.json().catch(() => ({ error: dispatch.statusText }))
        throw new Error(`[claudeClient] negotiate dispatch failed: ${d.error || dispatch.statusText}`)
    }

    onStatus?.('Turn dispatched — generating response…')

    // 2. Poll until complete / error / timeout.
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS)

        let statusRes
        try {
            statusRes = await fetch(`/api/turn-status?turn_id=${encodeURIComponent(turnId)}`)
        } catch {
            continue // transient network blip — keep polling
        }
        if (!statusRes.ok) continue

        const status = await statusRes.json().catch(() => null)
        if (!status) continue

        if (status.status === 'complete') {
            return status.result
        }
        if (status.status === 'error') {
            throw new Error(`[claudeClient] negotiate failed: ${status.error}`)
        }
        // 'pending' | 'processing' → keep polling
        onStatus?.(status.status === 'processing' ? 'Negotiator thinking…' : 'Waiting for worker…')
    }

    throw new Error('[claudeClient] negotiate timed out after 180s — check function logs.')
}

export async function initSession({
    domain,
    configId,
    perspective = 'seller',
    batnaValue,        // NEW: wire the UI's BATNA through (previously dropped)
    batnaDescription,  // NEW
    maxTurns,          // NEW
}) {
    const r = await fetch('/api/init-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            domain,
            config_id: configId,
            perspective,
            batna_value: batnaValue,
            batna_description: batnaDescription,
            max_turns: maxTurns,
        }),
    })
    if (!r.ok) {
        const c = await r.json().catch(() => ({ error: r.statusText }))
        throw new Error(`[claudeClient] initSession failed: ${c.error || r.statusText}`)
    }
    return r.json()
}

export async function endSession({ sessionId, outcome, finalValue }) {
    const r = await fetch('/api/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, outcome, final_value: finalValue }),
    })
    if (!r.ok) {
        const c = await r.json().catch(() => ({ error: r.statusText }))
        throw new Error(`[claudeClient] endSession failed: ${c.error || r.statusText}`)
    }
    return r.json()
}
