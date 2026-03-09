/**
 * Netlify Function: endSession
 * POST /api/end-session
 * Body: { session_id: string, outcome: string, final_value: number }
 * Finalizes the session, records outcome and win_vs_target.
 */

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
)

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    let body
    try {
        body = JSON.parse(event.body)
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
    }

    const { session_id, outcome, final_value } = body

    if (!session_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'session_id is required' }) }
    }

    try {
        // Fetch session to get config snapshot (for target value comparison)
        const { data: session, error: fetchError } = await supabase
            .from('sessions')
            .select('config_snapshot')
            .eq('id', session_id)
            .single()

        if (fetchError) throw new Error(`Session fetch failed: ${fetchError.message}`)

        // Compute win_vs_target: how much better than BATNA did we do?
        const batnaValue = session.config_snapshot?.batna_value || 0
        const winVsTarget =
            typeof final_value === 'number' && batnaValue !== 0
                ? ((final_value - batnaValue) / Math.abs(batnaValue)) * 100
                : null

        // Update session
        const { data: updated, error: updateError } = await supabase
            .from('sessions')
            .update({
                outcome: outcome || 'concluded',
                win_vs_target: winVsTarget,
            })
            .eq('id', session_id)
            .select()
            .single()

        if (updateError) throw new Error(`Session update failed: ${updateError.message}`)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id,
                outcome: updated.outcome,
                win_vs_target: winVsTarget,
                final_value,
            }),
        }
    } catch (err) {
        console.error('[endSession]', err)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        }
    }
}
