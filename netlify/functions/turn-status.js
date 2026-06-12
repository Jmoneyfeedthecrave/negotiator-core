/**
 * Netlify Function: turn-status
 * GET /api/turn-status?turn_id=<uuid>
 *
 * Polled by the frontend after dispatching a turn to /api/negotiate-background.
 *
 * Responses:
 *   { status: 'pending' }                       — turn row not written yet (background fn still booting)
 *   { status: 'processing' }                    — turn in progress
 *   { status: 'complete', result: {...} }       — final structured turn result
 *   { status: 'error', error: '...' }           — turn failed
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

export const handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    const turnId = event.queryStringParameters?.turn_id
    if (!turnId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'turn_id query parameter required' }) }
    }

    try {
        const { data: turn, error } = await supabase
            .from('negotiation_turns')
            .select('status, result, error')
            .eq('id', turnId)
            .maybeSingle()

        if (error) throw new Error(`Turn fetch failed: ${error.message}`)

        if (!turn) {
            // Background function hasn't written its row yet — normal for the first
            // second or two after dispatch. The client treats this as "keep polling".
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'pending' }),
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: turn.status,
                ...(turn.status === 'complete' ? { result: turn.result } : {}),
                ...(turn.status === 'error' ? { error: turn.error } : {}),
            }),
        }
    } catch (err) {
        console.error('[turn-status]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
