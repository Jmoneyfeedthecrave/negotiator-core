import { getSupabaseAdmin, requireAuth } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    const authErr = requireAuth(event); if (authErr) return authErr

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) } }

    const { session_id, outcome = 'completed', final_value } = body
    if (!session_id) return { statusCode: 400, body: JSON.stringify({ error: 'session_id required' }) }

    try {
        const { data: session, error: fetchErr } = await getDB().from('sessions').select('*').eq('id', session_id).single()
        if (fetchErr) throw new Error(`Session fetch failed: ${fetchErr.message}`)

        const win_vs_target = final_value !== null && final_value !== undefined && session.config_snapshot?.target_value
            ? ((final_value - (session.config_snapshot.batna_value || 0)) / (session.config_snapshot.target_value - (session.config_snapshot.batna_value || 0))) * 100
            : null

        const { error: updateErr } = await getDB().from('sessions').update({ outcome, win_vs_target }).eq('id', session_id)
        if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

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
