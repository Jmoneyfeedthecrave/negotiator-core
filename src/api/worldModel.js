import { supabase } from './supabaseClient.js'

export async function getWorldModel(sessionId) {
    const { data, error } = await supabase
        .from('world_model')
        .select('*')
        .eq('session_id', sessionId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) throw new Error(`[getWorldModel] ${error.message}`)
    if (!data) throw new Error(`[getWorldModel] No world model found for session ${sessionId}`)
    return data
}

export async function updateWorldModel(sessionId, patch) {
    const { data, error } = await supabase
        .from('world_model')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .select()
        .maybeSingle()
    if (error) throw new Error(`[updateWorldModel] ${error.message}`)
    return data
}

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
        .maybeSingle()
    if (error) throw new Error(`[createWorldModel] ${error.message}`)
    return data
}
