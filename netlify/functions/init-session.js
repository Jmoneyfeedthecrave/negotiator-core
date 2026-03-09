/**
 * Netlify Function: initSession
 * POST /api/init-session
 * Body: { domain: string, config_id?: string }
 * Creates a sessions row and a world_model row. Returns { session_id, world_model_id }
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

    const { domain, config_id } = body

    if (!domain) {
        return { statusCode: 400, body: JSON.stringify({ error: 'domain is required' }) }
    }

    try {
        // Load config if provided
        let configSnapshot = {}
        let batnaValue = 0
        let concessionBudget = 20

        if (config_id) {
            const { data: config, error: configError } = await supabase
                .from('configs')
                .select('*')
                .eq('id', config_id)
                .single()

            if (configError) throw new Error(`Config fetch failed: ${configError.message}`)
            configSnapshot = config
            batnaValue = config.batna_value || 0
            concessionBudget = config.concession_budget || 20
        }

        // Create session
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .insert({
                domain,
                transcript: [],
                config_snapshot: configSnapshot,
            })
            .select()
            .single()

        if (sessionError) throw new Error(`Session creation failed: ${sessionError.message}`)

        // Create initial world model
        const { data: worldModel, error: wmError } = await supabase
            .from('world_model')
            .insert({
                session_id: session.id,
                current_offer: {},
                concession_remaining: concessionBudget,
                counterparty_beliefs: {},
                bluff_tracker: [],
                turn_history: [],
            })
            .select()
            .single()

        if (wmError) throw new Error(`World model creation failed: ${wmError.message}`)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: session.id,
                world_model_id: worldModel.id,
                domain,
                batna_value: batnaValue,
            }),
        }
    } catch (err) {
        console.error('[initSession]', err)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        }
    }
}
