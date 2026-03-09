/**
 * worldModel.js
 * Helper functions for reading and writing world model state in Supabase.
 * Called by the Netlify functions server-side AND by the frontend for display reads.
 */

import { supabase } from './supabaseClient.js'

/**
 * Fetch the current world model for a session.
 * @param {string} sessionId
 * @returns {Promise<object>} world model row
 */
export async function getWorldModel(sessionId) {
    const { data, error } = await supabase
        .from('world_model')
        .select('*')
        .eq('session_id', sessionId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()

    if (error) throw new Error(`[getWorldModel] ${error.message}`)
    return data
}

/**
 * Patch the world model with new state (partial update).
 * @param {string} sessionId
 * @param {object} patch - partial fields to update
 * @returns {Promise<object>} updated row
 */
export async function updateWorldModel(sessionId, patch) {
    const { data, error } = await supabase
        .from('world_model')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .select()
        .single()

    if (error) throw new Error(`[updateWorldModel] ${error.message}`)
    return data
}

/**
 * Create an initial world model row for a new session.
 * @param {string} sessionId
 * @param {object} initialOffer
 * @param {number} concessionBudget
 * @returns {Promise<object>} created row
 */
export async function createWorldModel(sessionId, initialOffer = {}, concessionBudget = 20) {
    const { data, error } = await supabase
        .from('world_model')
        .insert({
            session_id: sessionId,
            current_offer: initialOffer,
            concession_remaining: concessionBudget,
            counterparty_beliefs: {},
            bluff_tracker: [],
            turn_history: [],
        })
        .select()
        .single()

    if (error) throw new Error(`[createWorldModel] ${error.message}`)
    return data
}
