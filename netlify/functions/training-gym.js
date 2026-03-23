/**
 * Netlify Function: training-gym
 * POST /api/training-gym
 * Runs ARCHI through multiple negotiation scenarios against various personas.
 * Each scenario generates lessons that feed back into learned_patterns.
 *
 * Body: {
 *   scenarios?: number,          // how many scenarios to run (default 3, max 5)
 *   domain?: string,
 *   persona_ids?: string[],      // specific personas or 'random'
 *   batna_value?: number,
 *   target_value?: number,
 * }
 */

$args[0].Groups[1].Value + $args[0].Groups[2].Value + ", handleOptions" + $args[0].Groups[3].Value

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

const ALL_PERSONAS = PERSONAS.map(p => p.id)

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
    if (event.httpMethod === 'OPTIONS') return handleOptions()
    const authErr = requireAuth(event); if (authErr) return authErr

    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch {}

    const {
        scenarios = 3,
        domain = 'General Business Negotiation',
        persona_ids = [],
        batna_value = 80,
        target_value = 100,
    } = body

    const numScenarios = Math.min(Math.max(scenarios, 1), 5)

    // Pick personas: use specified ones, or random from the full list
    let selectedPersonas = []
    if (persona_ids.length > 0) {
        selectedPersonas = persona_ids.slice(0, numScenarios)
    } else {
        // Shuffle and pick
        const shuffled = [...ALL_PERSONAS].sort(() => Math.random() - 0.5)
        selectedPersonas = shuffled.slice(0, numScenarios)
    }

    // Get pattern count before training
    const { count: patternsBefore } = await getDB()
        .from('learned_patterns')
        .select('id', { count: 'exact', head: true })

    const results = []
    let wins = 0
    let losses = 0
    let stalemates = 0

    // Run scenarios sequentially (each calls simulate endpoint)
    for (const personaId of selectedPersonas) {
        try {
            const simResponse = await fetch(`${process.env.URL}/.netlify/functions/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
            },
                body: JSON.stringify({
                    domain,
                    persona_id: personaId,
                    max_turns: 8,
                    batna_value,
                    target_value,
                    opening_offer: Math.round(target_value * 1.2),
                }),
            })

            const simResult = await simResponse.json()
            results.push({
                persona: simResult.persona_name || personaId,
                outcome: simResult.outcome,
                final_value: simResult.final_value,
                win_vs_target: simResult.win_vs_target,
                techniques_used: simResult.techniques_used || [],
                turns: simResult.turns_taken,
            })

            if (simResult.outcome === 'won') wins++
            else if (simResult.outcome === 'batna_breach') losses++
            else stalemates++ // stalemate, error, etc.
        } catch (err) {
            results.push({ persona: personaId, outcome: 'error', error: err.message })
        }
    }

    // Get pattern count after training
    const { count: patternsAfter } = await getDB()
        .from('learned_patterns')
        .select('id', { count: 'exact', head: true })

    const newPatternsCreated = (patternsAfter || 0) - (patternsBefore || 0)

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
            },
        body: JSON.stringify({
            training_complete: true,
            scenarios_run: results.length,
            win_rate: results.length > 0 ? Math.round((wins / results.length) * 100) : 0,
            wins,
            losses,
            stalemates,
            new_patterns_created: newPatternsCreated,
            total_patterns: patternsAfter || 0,
            results,
        }),
    }
}
