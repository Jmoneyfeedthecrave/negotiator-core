/**
 * Netlify Function: init-session — PATCHED
 * POST /api/init-session
 * Body: { domain, config_id?, perspective?, batna_value?, batna_description?, max_turns? }
 *
 * Change vs. original: the UI's BATNA value, BATNA description, and max turns
 * were collected in the console but never transmitted, so every test-harness
 * session ran with batna_value 0 and the BATNA hard-stop logic was inert.
 * Direct values now merge into config_snapshot (a saved config_id still wins
 * for any field it defines).
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

    const {
        domain,
        config_id,
        perspective = 'seller',
        batna_value,
        batna_description,
        max_turns,
    } = body

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

            if (config.config_key?.startsWith('counter_strategy_')) {
                throw new Error(`Config ${config_id} is a persona strategy record, not a live config.`)
            }

            configSnapshot = config
            batnaValue = config.batna_value || 0
            concessionBudget = config.concession_budget || 20
        }

        // NEW: direct BATNA / limits from the request fill any gaps the saved
        // config didn't define (test-harness sessions have no config_id at all).
        if (typeof batna_value === 'number' && !configSnapshot.batna_value) {
            configSnapshot.batna_value = batna_value
            batnaValue = batna_value
        }
        if (batna_description && !configSnapshot.batna_description) {
            configSnapshot.batna_description = batna_description
        }
        if (typeof max_turns === 'number' && !configSnapshot.max_turns) {
            configSnapshot.max_turns = max_turns
        }
        if (!configSnapshot.domain_label) configSnapshot.domain_label = domain
        if (!configSnapshot.concession_budget) configSnapshot.concession_budget = concessionBudget

        // Embed perspective into the config snapshot so negotiate always has it
        configSnapshot = {
            ...configSnapshot,
            variables: { ...(configSnapshot.variables || {}), perspective },
        }

        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .insert({ domain, transcript: [], config_snapshot: configSnapshot })
            .select().maybeSingle()
        if (sessionError) throw new Error(`Session creation failed: ${sessionError.message}`)

        const { data: worldModel, error: wmError } = await supabase
            .from('world_model')
            .insert({
                session_id: session.id,
                current_offer: {},
                concession_remaining: configSnapshot.concession_budget,
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
                batna_value: configSnapshot.batna_value || 0,
                perspective,
            }),
        }
    } catch (err) {
        console.error('[initSession]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
