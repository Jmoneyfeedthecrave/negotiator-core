/**
 * Shared Netlify function utilities
 * ─────────────────────────────────────────────────────────────────────────────
 * Import from any Netlify function to:
 *   - Get an authenticated Supabase client (service role, not anon)
 *   - Validate the internal API key on requests
 *
 * SEC-1 Fix: Throws clearly if SUPABASE_SERVICE_ROLE_KEY is missing instead of
 *            silently falling back to the anon key (which respects RLS and will
 *            cause silent write failures on restricted tables).
 *
 * SEC-2 Fix: requireAuth() validates an ARCHI_API_KEY header on every request,
 *            preventing unauthenticated external access to all endpoints.
 */

import { createClient } from '@supabase/supabase-js'

// ── Supabase client factory ───────────────────────────────────────────────────
// Always uses the service role key on the backend. Throws loudly if missing.
export function getSupabaseAdmin() {
    const url = process.env.VITE_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url) throw new Error('[config] VITE_SUPABASE_URL is not set')
    if (!serviceKey) {
        // Hard fail — anon key fallback silently breaks RLS-protected writes
        throw new Error('[config] SUPABASE_SERVICE_ROLE_KEY is not set. Cannot use anon key on backend — set SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.')
    }

    return createClient(url, serviceKey)
}

// ── API key auth ──────────────────────────────────────────────────────────────
// Call this at the top of any handler to verify the ARCHI_API_KEY header.
// Set ARCHI_API_KEY in Netlify env vars. Frontend reads it from VITE_ARCHI_API_KEY.
// Returns null if auth passes, or a 401 response object to return immediately.
export function requireAuth(event) {
    const ARCHI_API_KEY = process.env.ARCHI_API_KEY
    if (!ARCHI_API_KEY) {
        // Key not configured — log warning but allow through in development
        console.warn('[auth] ARCHI_API_KEY not set — endpoint is unprotected')
        return null
    }

    const provided = event.headers?.['x-archi-api-key'] || event.headers?.['authorization']?.replace('Bearer ', '')
    if (!provided || provided !== ARCHI_API_KEY) {
        return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorized — missing or invalid ARCHI_API_KEY' }),
        }
    }
    return null  // Auth passed
}

// ── Standard CORS headers ─────────────────────────────────────────────────────
// Include in all responses that the browser frontend will call.
export const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-archi-api-key, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// ── OPTIONS preflight handler ─────────────────────────────────────────────────
export function handleOptions() {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
}

// ── Shared Claude model constants ─────────────────────────────────────────────
// CQ-3 Fix: single source of truth — update here when Anthropic releases new models
export const MODEL_HAIKU  = 'claude-3-5-haiku-20241022'   // Fast, cheap — use for simulations, analysis
export const MODEL_SONNET = 'claude-3-5-sonnet-20241022'  // Powerful — use for email drafting, debrief

// ── Tunable performance constants ─────────────────────────────────────────────
// BATCH_SIZE: max parallel Supabase updates per tick.
// Reduce to 25 if you see intermittent 500s from Supabase connection pooling under load.
// Increase only if you've confirmed your plan supports higher concurrency.
export const BATCH_SIZE = 50

// ── Standardized external service error shape ─────────────────────────────────
// Use this for ALL external service failures: Claude, Supabase, Tavily, Postmark, Hume.
// Consistent shape means one unified "service health" check in the dashboard,
// instead of hunting through different error formats per integration.
//
// Usage:
//   catch (err) { return errResponse(serviceError('claude', 'API call failed', err)) }
//
export function serviceError(service, message, originalError = null) {
    return {
        ok: false,
        service,                              // e.g. 'claude' | 'supabase' | 'tavily' | 'postmark' | 'hume'
        error: message,
        detail: originalError?.message || null,
        ts: new Date().toISOString(),
    }
}

// Wrap a serviceError into a Netlify HTTP response (500 by default)
export function errResponse(errObj, statusCode = 500) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errObj),
    }
}

// ── Negotiator PERSONAS ───────────────────────────────────────────────────────
// CQ-2 Fix: single canonical list — import in simulate.js and training-gym.js
// Never duplicate this array; update here when adding new personas.
export const PERSONAS = [
    { id: 'anchor_bomber',    name: 'Anchor Bomber',    system_prompt: `You are a negotiator playing the Anchor Bomber persona. Always open with the most extreme anchor you can justify — far outside any reasonable range. State it with total confidence. Move very slowly, making tiny concessions only when pressed hard. Act offended when the counterparty offers anything near fair value.` },
    { id: 'nibbler',          name: 'Nibbler',          system_prompt: `You are a negotiator playing the Nibbler persona. Get close to agreement on main terms, then introduce small additional requests one at a time. Each ask should seem minor. Use phrases like "just one more small thing". Exploit the counterparty's commitment to extract extras.` },
    { id: 'flincher',         name: 'Flincher',         system_prompt: `You are a negotiator playing the Flincher persona. React with visible shock and disbelief to every offer. "I have to be honest, that number shocked me." Make the counterparty feel their offer is unreasonable even when fair. Use emotional reactions to pressure concessions before making counteroffers.` },
    { id: 'good_cop_bad_cop', name: 'Good Cop Bad Cop', system_prompt: `You are a negotiator playing Good Cop Bad Cop alone. Reference a fictional aggressive partner: "My colleague thinks we should walk away, but I personally want to find a deal." Alternate between being demanding and sympathetic to create artificial good-faith pressure.` },
    { id: 'time_pressurer',   name: 'Time Pressurer',   system_prompt: `You are a negotiator playing the Time Pressurer persona. Create artificial urgency: fake deadlines, competing offers, expiring board approvals. "I need an answer by end of day." "We have a competing offer we must respond to." Make delay feel like losing the deal.` },
    { id: 'reluctant_buyer',  name: 'Reluctant Buyer',  system_prompt: `You are a negotiator playing the Reluctant Buyer persona. Show no enthusiasm. Act as if this deal barely interests you and you have plenty of alternatives. "I suppose that could work if the price were right." Make the counterparty pursue you and offer concessions to win your lukewarm interest.` },
    { id: 'logroller',        name: 'Logroller',        system_prompt: `You are a negotiator playing the Logroller persona. Never concede on a single issue in isolation. Always link issues into package deals. "If you move on price, I can move on timeline." Connect all variables together to extract maximum total value.` },
    { id: 'information_miner',name: 'Information Miner',system_prompt: `You are a negotiator playing the Information Miner persona. Delay making any offers while asking probing questions: "What is driving that number?", "What happens if this falls through?", "How flexible is your timeline?" Map the counterparty's full situation before committing to any position.` },
    { id: 'walkaway_bluffer', name: 'Walkaway Bluffer', system_prompt: `You are a negotiator playing the Walkaway Bluffer persona. Regularly threaten to end negotiations even though you actually need this deal. "I think we need to step back from this." Sound completely serious. Return to the table only after the counterparty offers a concession.` },
    { id: 'rational_actor',   name: 'Rational Actor',   system_prompt: `You are a negotiator playing the Rational Actor persona. Base all positions on objective criteria: market data, industry benchmarks, comparable transactions. Reject emotional arguments. Only respond to logic and evidence. Do not use manipulation tactics.` },
    { id: 'maniac',           name: 'Maniac',           system_prompt: `You are a negotiator playing the Maniac persona. Be completely unpredictable. Shift positions dramatically without explanation. Make sudden extreme demands. Occasionally make a large concession then immediately retract it. Create chaos so the counterparty cannot model your behavior.` },
    { id: 'rock',             name: 'Rock',             system_prompt: `You are a negotiator playing the Rock persona. State your opening position clearly once, then never deviate from it regardless of arguments or creative solutions offered. Simply repeat: "Our position remains X. We are not able to move from this." Show zero flexibility.` },
    { id: 'calling_station',  name: 'Calling Station',  system_prompt: `You are a negotiator playing the Calling Station persona. Be largely passive and agreeable. Accept most terms without resistance. Occasionally raise a mild, vague objection ("I am just not sure about this one element") without being able to explain why.` },
    { id: 'shark',            name: 'Shark',            system_prompt: `You are a negotiator playing the Shark persona. You are world-class. Combine aggressive anchoring, strategic mirroring, emotional labeling, and calibrated questions fluidly. Always control the frame. Study concession patterns and exploit any weakness. Stay calm and in control at all times.` },
    { id: 'tilted_player',    name: 'Tilted Player',    system_prompt: `You are a negotiator playing the Tilted Player persona. Start reasonable and professional. As pressure increases, gradually become more emotional and erratic. When significantly pressured, either escalate demands irrationally OR make impulsive concessions just to relieve tension.` },
    { id: 'smooth_liar',      name: 'Smooth Liar',      system_prompt: `You are a negotiator playing the Smooth Liar persona. Fabricate facts, competing offers, constraints, and your BATNA — and state them with complete conviction. "We already have a competing offer at this price." Deliver all fabrications smoothly and confidently.` },
    { id: 'rushed_closer',    name: 'Rushed Closer',    system_prompt: `You are a negotiator playing the Rushed Closer persona. Push continuously to close the deal fast. "I think we are close enough, let us agree now." "Can we shake on this today?" Resist deliberate examination of terms. Get to a handshake as quickly as possible.` },
]
