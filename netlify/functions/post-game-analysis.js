/**
 * Netlify Function: post-game-analysis
 * POST /api/post-game-analysis
 * After a simulation session, calls Claude to extract tactic observations
 * and writes insights to tactic_library and configs tables.
 *
 * Body: { session_id: string }
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) } }

    const { session_id } = body
    if (!session_id) return { statusCode: 400, body: JSON.stringify({ error: 'session_id required' }) }

    try {
        // Fetch session
        const { data: session, error: sessErr } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', session_id)
            .single()
        if (sessErr) throw new Error(`Session fetch failed: ${sessErr.message}`)

        const transcript = session.transcript || []
        const outcome = session.outcome
        const personaId = session.config_snapshot?.persona_id || 'unknown'

        // Build transcript text for Claude
        const transcriptText = transcript.map(t =>
            `[Turn ${t.turn}] ${t.speaker.toUpperCase()}${t.technique ? ` (${t.technique})` : ''}: ${t.content}${t.offer ? ` [Offer: ${t.offer}]` : ''}`
        ).join('\n')

        // Ask Claude to extract insights
        const analysisPrompt = `You are an expert negotiation analyst. Review this negotiation simulation transcript and extract key insights.

OUTCOME: ${outcome}
PERSONA FACED: ${personaId}

TRANSCRIPT:
${transcriptText}

Extract exactly these insights as JSON:
{
  "most_effective_tactic": "name of the single most effective tactic used by Negotiator A",
  "most_effective_tactic_reason": "brief explanation of why it worked",
  "key_mistake": "the most significant mistake made (or null if played well)",
  "persona_counter_strategy": "best strategy to counter the ${personaId} persona in future sessions",
  "tactic_observations": [
    { "tactic_name": "string", "was_effective": true, "context": "brief context" }
  ],
  "summary": "2-sentence session summary"
}
Respond ONLY with valid JSON.`

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 1024,
            messages: [{ role: 'user', content: analysisPrompt }],
        })

        let analysis
        try {
            const text = response.content[0]?.text || ''
            const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
            analysis = JSON.parse(match ? match[1].trim() : text.trim())
        } catch {
            analysis = { most_effective_tactic: 'unknown', summary: 'Analysis parsing failed.', tactic_observations: [] }
        }

        // Write tactic observations to tactic_library (using correct column: tactic_observed)
        if (Array.isArray(analysis.tactic_observations)) {
            for (const obs of analysis.tactic_observations) {
                try {
                    await supabase.from('tactic_library').upsert({
                        tactic_observed: obs.tactic_name,
                        domain: 'simulation',
                        counter_move: obs.was_effective ? 'continue' : 'adjust',
                        outcome: obs.was_effective ? 'effective' : 'ineffective',
                        was_effective_vs_persona: obs.was_effective,
                        persona_id: personaId,
                        context_notes: obs.context,
                        session_id,
                        last_updated: new Date().toISOString(),
                    }, { onConflict: 'tactic_observed,persona_id', ignoreDuplicates: false })
                } catch (e) {
                    console.warn('[post-game-analysis] tactic upsert skipped:', e.message)
                }
            }
        }

        // Store persona counter strategy in configs (using config_key column added in Phase 2 migration)
        try {
            await supabase.from('configs').upsert({
                domain_label: `counter_strategy_${personaId}`,
                config_key: `counter_strategy_${personaId}`,
                config_value: {
                    persona_id: personaId,
                    strategy: analysis.persona_counter_strategy,
                    updated_at: new Date().toISOString(),
                },
                variables: {},
                weights: {},
                red_lines: {},
                batna_value: 0,
                concession_budget: 0,
                approval_triggers: [],
            }, { onConflict: 'config_key' })
        } catch (e) {
            console.warn('[post-game-analysis] config upsert skipped:', e.message)
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id,
                analysis,
                tactic_observations_written: analysis.tactic_observations?.length || 0,
            }),
        }
    } catch (err) {
        console.error('[post-game-analysis]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
