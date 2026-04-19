/**
 * Netlify Function: end-session
 * POST /api/end-session
 * Body: { session_id, outcome?, final_value? }
 * Marks a session complete, computes win_vs_target, auto-triggers post-game-analysis.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) } }

    const { session_id, outcome = 'completed', final_value } = body
    if (!session_id) return { statusCode: 400, body: JSON.stringify({ error: 'session_id required' }) }

    try {
        const { data: session, error: fetchErr } = await supabase
            .from('sessions').select('*').eq('id', session_id).maybeSingle()
        if (fetchErr) throw new Error(`Session fetch failed: ${fetchErr.message}`)
        if (!session) throw new Error(`Session not found: ${session_id}`)

        // DFB-2: guard divide-by-zero when target == batna
        let win_vs_target = null
        const targetValue = session.config_snapshot?.target_value
        const batnaValue = session.config_snapshot?.batna_value || 0
        const range = targetValue - batnaValue
        if (final_value != null && targetValue != null && range !== 0) {
            win_vs_target = ((final_value - batnaValue) / range) * 100
        }

        const { error: updateErr } = await supabase
            .from('sessions')
            .update({ outcome, win_vs_target, status: 'completed' })
            .eq('id', session_id)
        if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

        // MF-4: Auto-trigger post-game-analysis (fire-and-forget — don't block the response)
        if (process.env.URL) {
            fetch(`${process.env.URL}/.netlify/functions/post-game-analysis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id }),
            }).catch(err => console.error('[end-session] post-game-analysis trigger failed:', err.message))
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id, outcome, win_vs_target }),
        }
    } catch (err) {
        console.error('[endSession]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
