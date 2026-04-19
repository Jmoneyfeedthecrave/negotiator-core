/**
 * Netlify Function: init-session
 * POST /api/init-session
 * Body: { domain, config_id?, perspective? }
 * Creates a session + world_model row, returns session_id.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }

    let body
    try {
        body = JSON.parse(event.body)
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
    }

    // DFB-1: accept explicit perspective so buyers are tracked correctly
    const { domain, config_id, perspective = 'seller' } = body

    if (!domain) {
        return { statusCode: 400, body: JSON.stringify({ error: 'domain is required' }) }
    }

    try {
        let configSnapshot = {}
        let batnaValue = 0
        let concessionBudget = 20

        if (config_id) {
            const { data: config, error: configError } = await supabase
                .from('configs').select('*').eq('id', config_id).maybeSingle()
            if (configError) throw new Error(`Config fetch failed: ${configError.message}`)
            if (!config) throw new Error(`Config not found: ${config_id}`)

            // Reject post-game persona strategy rows accidentally used as live configs
            if (config.config_key?.startsWith('counter_strategy_')) {
                throw new Error(`Config ${config_id} is a persona strategy record, not a live config.`)
            }

            configSnapshot = config
            batnaValue = config.batna_value || 0
            concessionBudget = config.concession_budget || 20
        }

        // Embed perspective into the config snapshot so negotiate.js always has it
        configSnapshot = { ...configSnapshot, variables: { ...(configSnapshot.variables || {}), perspective } }

        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .insert({ domain, transcript: [], config_snapshot: configSnapshot })
            .select().maybeSingle()
        if (sessionError) throw new Error(`Session creation failed: ${sessionError.message}`)

        const { data: worldModel, error: wmError } = await supabase
            .from('world_model')
            .insert({
                session_id: session.id,
                current_offer: {},            // will be set on first negotiate turn
                concession_remaining: concessionBudget,
                counterparty_beliefs: {},
                bluff_tracker: [],
                turn_history: [],
            }).select().maybeSingle()
        if (wmError) throw new Error(`World model creation failed: ${wmError.message}`)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: session.id,
                world_model_id: worldModel.id,
                domain,
                batna_value: batnaValue,
                perspective,
            }),
        }
    } catch (err) {
        console.error('[initSession]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
