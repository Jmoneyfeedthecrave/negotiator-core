/**
 * Netlify Function: negotiate
 * POST /api/negotiate
 * Body: {
 *   session_id: string,
 *   counterparty_message: string,
 *   mode: 'coached' | 'autonomous',
 *   concession_flag?: object
 * }
 *
 * Full pipeline:
 * 1. Load world model + config + technique_library from Supabase
 * 2. BATNA hard check (block if breached)
 * 3. Build dynamic system prompt (with technique library + world model + concession flag)
 * 4. Call Claude API — receives structured JSON response
 * 5. Parse and validate Claude JSON response
 * 6. Update world model in Supabase (offer, beliefs, bluff_tracker, turn_history)
 * 7. Update session transcript
 * 8. Return structured result to frontend
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// ── Inline engine helpers (Netlify functions cannot import from src/) ─────────

function checkBATNA(currentOffer, batnaValue, batnaDescription = '', perspective = 'seller') {
    const offerValue = typeof currentOffer?.value === 'number' ? currentOffer.value : null
    if (offerValue === null) return { breached: false, reason: null }

    const breached =
        perspective === 'seller' ? offerValue < batnaValue : offerValue > batnaValue

    if (breached) {
        return {
            breached: true,
            reason: `BATNA HARD STOP: Current offer of ${offerValue} breaches the BATNA floor of ${batnaValue}${batnaDescription ? ` (${batnaDescription})` : ''}. Claude API call blocked.`,
        }
    }
    return { breached: false, reason: null }
}

function buildSystemPrompt({ worldModel, config, techniques, concessionFlag, mode }) {
    const {
        current_offer,
        concession_remaining,
        counterparty_beliefs,
        bluff_tracker,
        turn_history,
    } = worldModel

    const {
        domain_label,
        batna_value,
        batna_description,
        opening_strategy,
        concession_budget,
        red_lines,
        variables,
        weights,
    } = config

    const techniqueBlock = techniques
        .map(
            (t) =>
                `[${t.category.toUpperCase()}] ${t.technique_name}
  Description: ${t.description}
  When to apply: ${t.application_context || 'See description.'}
  Counter: ${t.counter_technique || 'N/A'}`
        )
        .join('\n\n')

    const worldModelBlock = `
CURRENT NEGOTIATION STATE:
- Domain: ${domain_label}
- Our current offer: ${JSON.stringify(current_offer)}
- Concession budget remaining: ${concession_remaining}% of ${concession_budget}% total
- BATNA value: ${batna_value} (${batna_description || 'Do not accept below this under any circumstances'})
- Opening strategy: ${opening_strategy || 'anchoring'}
- Red lines (hard stops): ${JSON.stringify(red_lines)}
- Domain variables: ${JSON.stringify(variables)}
- Domain weights: ${JSON.stringify(weights)}
- Counterparty belief model: ${JSON.stringify(counterparty_beliefs)}
- Active bluff tracker: ${JSON.stringify(bluff_tracker)}
- Full turn history: ${JSON.stringify(turn_history)}
`.trim()

    const concessionWarningBlock =
        concessionFlag?.warning ? `\n\nCRITICAL CONCESSION ALERT:\n${concessionFlag.flag}\n` : ''

    const modeBlock =
        mode === 'coached'
            ? 'MODE: COACHED. Your natural_language_response will be shown to a human negotiator for approval before being sent to the counterparty.'
            : 'MODE: AUTONOMOUS. Your natural_language_response will be delivered directly to the counterparty. Speak in first person as the negotiator.'

    const outputFormatBlock = `
OUTPUT FORMAT — CRITICAL:
Respond with ONLY valid JSON, no prose before or after:

{
  "internal_reasoning": "Step-by-step strategic thinking including Nash Equilibrium analysis, EV calculation, and range analysis.",
  "technique_detected": "Name of technique counterparty just used.",
  "technique_detected_reasoning": "Why you believe they used this technique.",
  "technique_applied": "Name of technique you are applying.",
  "technique_applied_reasoning": "Why this technique is optimal right now.",
  "move": "Brief strategic move label.",
  "natural_language_response": "Exact words to say or send to counterparty.",
  "confidence_score": 0.0,
  "bluff_probability_updates": [
    {
      "claim": "Exact counterparty claim being assessed",
      "probability": 0.0,
      "evidence_for": "Signals suggesting claim is true",
      "evidence_against": "Signals suggesting claim is false",
      "recommended_response": "Strategic response to this claim"
    }
  ],
  "updated_offer": { "value": 0, "description": "" },
  "updated_counterparty_beliefs": {},
  "bayesian_update_notes": "How this turn updated your belief model."
}`.trim()

    return `You are an elite autonomous AI negotiator combining principled negotiation theory, game theory, behavioural psychology, and poker strategy.

${modeBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEGOTIATION TECHNIQUE LIBRARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${techniqueBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${worldModelBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${concessionWarningBlock}
Before responding you MUST internally:
1. Identify the counterparty technique and underlying interest.
2. Select the optimal counter-technique from the library.
3. Run Nash Equilibrium and EV analysis on current game state.
4. Update Bayesian beliefs on counterparty BATNA and all claims.
5. Assess bluff probabilities for all active claims.
6. Verify your move does not breach BATNA or red lines.
7. Craft your move for maximum expected value.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${outputFormatBlock}
`
}

// ── Main handler ──────────────────────────────────────────────────────────────

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
)

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

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

    const { session_id, counterparty_message, mode = 'coached', concession_flag } = body

    if (!session_id || !counterparty_message) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'session_id and counterparty_message are required' }),
        }
    }

    try {
        // ── 1. Load world model ──────────────────────────────────────────────────
        const { data: worldModel, error: wmError } = await supabase
            .from('world_model')
            .select('*')
            .eq('session_id', session_id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .single()

        if (wmError) throw new Error(`World model fetch failed: ${wmError.message}`)

        // ── 2. Load session + config ─────────────────────────────────────────────
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', session_id)
            .single()

        if (sessionError) throw new Error(`Session fetch failed: ${sessionError.message}`)

        // Use config_snapshot if no live config stored, else load from configs table
        let config = session.config_snapshot || {}
        if (!config.batna_value) {
            // Fallback defaults for test harness usage without saved config
            config = {
                domain_label: session.domain || 'general',
                batna_value: 0,
                batna_description: 'No BATNA set',
                opening_strategy: 'anchoring',
                concession_budget: 20,
                red_lines: {},
                variables: {},
                weights: {},
            }
        }

        // ── 3. BATNA hard check ──────────────────────────────────────────────────
        const perspective = config.variables?.perspective || 'seller'
        const batnaCheck = checkBATNA(
            worldModel.current_offer,
            config.batna_value,
            config.batna_description,
            perspective
        )

        if (batnaCheck.breached) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'batna_breach',
                    reason: batnaCheck.reason,
                    natural_language_response: `I cannot proceed. Your offer is below our minimum acceptable threshold. ${batnaCheck.reason}`,
                }),
            }
        }

        // ── 4. Load technique library ────────────────────────────────────────────
        const { data: techniques, error: techError } = await supabase
            .from('technique_library')
            .select('*')

        if (techError) throw new Error(`Technique library fetch failed: ${techError.message}`)

        // ── 5. Build system prompt ───────────────────────────────────────────────
        const systemPrompt = buildSystemPrompt({
            worldModel,
            config,
            techniques: techniques || [],
            concessionFlag: concession_flag || { warning: false, flag: null },
            mode,
        })

        // ── 6. Build conversation history for Claude ─────────────────────────────
        const transcript = session.transcript || []
        const messages = []

        // Replay existing transcript as alternating user/assistant turns
        for (const turn of transcript) {
            if (turn.role === 'counterparty') {
                messages.push({ role: 'user', content: turn.content })
            } else if (turn.role === 'negotiator') {
                messages.push({ role: 'assistant', content: turn.content })
            }
        }

        // Add current counterparty message
        messages.push({ role: 'user', content: counterparty_message })

        // ── 7. Call Claude API ───────────────────────────────────────────────────
        const claudeResponse = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 4096,
            system: systemPrompt,
            messages,
        })

        const rawText = claudeResponse.content[0]?.text || ''

        // ── 8. Parse and validate Claude JSON response ───────────────────────────
        let parsed
        try {
            // Claude may wrap JSON in markdown code fences — strip them
            const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim()
            parsed = JSON.parse(jsonStr)
        } catch {
            // If parsing fails, return raw text in a safe wrapper
            parsed = {
                internal_reasoning: 'JSON parse failed — raw response attached.',
                technique_detected: 'unknown',
                technique_detected_reasoning: '',
                technique_applied: 'unknown',
                technique_applied_reasoning: '',
                move: 'unstructured',
                natural_language_response: rawText,
                confidence_score: 0.5,
                bluff_probability_updates: [],
                updated_offer: worldModel.current_offer,
                updated_counterparty_beliefs: worldModel.counterparty_beliefs,
                bayesian_update_notes: '',
            }
        }

        // ── 9. Update world model ────────────────────────────────────────────────
        const newTurnEntry = {
            turn: (worldModel.turn_history?.length || 0) + 1,
            role: 'negotiator',
            counterparty_message,
            move: parsed.move,
            technique_detected: parsed.technique_detected,
            technique_applied: parsed.technique_applied,
            natural_language_response: parsed.natural_language_response,
            confidence_score: parsed.confidence_score,
            our_offer: parsed.updated_offer,
            timestamp: new Date().toISOString(),
        }

        const updatedTurnHistory = [...(worldModel.turn_history || []), newTurnEntry]
        const updatedBluffTracker = parsed.bluff_probability_updates?.length
            ? parsed.bluff_probability_updates
            : worldModel.bluff_tracker

        // Compute new concession remaining
        const offerBefore = worldModel.current_offer?.value
        const offerAfter = parsed.updated_offer?.value
        let newConcessionRemaining = worldModel.concession_remaining
        if (
            typeof offerBefore === 'number' &&
            typeof offerAfter === 'number' &&
            perspective === 'seller'
        ) {
            const concessionMade = offerBefore - offerAfter
            if (concessionMade > 0) {
                newConcessionRemaining = Math.max(0, worldModel.concession_remaining - concessionMade)
            }
        }

        const { error: wmUpdateError } = await supabase
            .from('world_model')
            .update({
                current_offer: parsed.updated_offer || worldModel.current_offer,
                concession_remaining: newConcessionRemaining,
                counterparty_beliefs: parsed.updated_counterparty_beliefs || worldModel.counterparty_beliefs,
                bluff_tracker: updatedBluffTracker,
                turn_history: updatedTurnHistory,
                updated_at: new Date().toISOString(),
            })
            .eq('session_id', session_id)

        if (wmUpdateError) {
            console.error('[negotiate] World model update failed:', wmUpdateError)
        }

        // ── 10. Update session transcript ────────────────────────────────────────
        const updatedTranscript = [
            ...transcript,
            { role: 'counterparty', content: counterparty_message, timestamp: new Date().toISOString() },
            {
                role: 'negotiator',
                content: parsed.natural_language_response,
                internal: parsed.internal_reasoning,
                timestamp: new Date().toISOString(),
            },
        ]

        await supabase
            .from('sessions')
            .update({ transcript: updatedTranscript })
            .eq('id', session_id)

        // ── 11. Return structured result ─────────────────────────────────────────
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: mode === 'coached' ? 'coached_draft' : 'autonomous_response',
                internal_reasoning: parsed.internal_reasoning,
                technique_detected: parsed.technique_detected,
                technique_detected_reasoning: parsed.technique_detected_reasoning,
                technique_applied: parsed.technique_applied,
                technique_applied_reasoning: parsed.technique_applied_reasoning,
                move: parsed.move,
                natural_language_response: parsed.natural_language_response,
                confidence_score: parsed.confidence_score,
                bluff_probability_updates: parsed.bluff_probability_updates || [],
                updated_offer: parsed.updated_offer,
                bayesian_update_notes: parsed.bayesian_update_notes,
                concession_remaining: newConcessionRemaining,
                turn_number: newTurnEntry.turn,
            }),
        }
    } catch (err) {
        console.error('[negotiate]', err)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        }
    }
}
