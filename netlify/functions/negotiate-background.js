/**
 * Netlify Background Function: negotiate-background
 * POST /api/negotiate-background
 *
 * IMPORTANT: the "-background" filename suffix is what makes Netlify run this
 * as a background function. Do not rename it without keeping the suffix.
 *
 * Body: {
 *   turn_id: string (uuid, generated client-side),
 *   session_id: string,
 *   counterparty_message: string,
 *   mode: 'coached' | 'autonomous',
 *   concession_flag?: object
 * }
 *
 * Netlify immediately returns 202 to the caller; this handler keeps running
 * (up to 15 min). Progress and the final result are written to the
 * negotiation_turns table, which the frontend polls via /api/turn-status.
 *
 * Fixes applied vs. the old negotiate.js:
 *  FIX-1  No more synchronous-timeout death: runs as a background function.
 *  FIX-2  Model switched to claude-sonnet-4-6 (much faster, structured-output friendly).
 *  FIX-3  Text block extracted by type, not position (thinking blocks broke content[0].text).
 *  FIX-4  Transcript no longer replayed as prose assistant turns (it contradicted the
 *         JSON-only contract and duplicated turn_history already in the system prompt).
 *         Recent dialogue is included as plain text inside the single user message.
 *  FIX-5  Concession accounting now uses consistent units (percent of opening offer),
 *         instead of subtracting dollars from a percentage.
 *  FIX-6  BATNA is now gated AFTER generation against Claude's proposed updated_offer,
 *         before anything is persisted — not a stale check of our own previous offer.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2500
const HISTORY_TURNS_IN_PROMPT = 10   // cap world-model history in the system prompt
const DIALOGUE_TURNS_IN_MESSAGE = 6  // cap recent dialogue lines in the user message

// ── Turn status helpers ───────────────────────────────────────────────────────

async function setTurnStatus(turnId, sessionId, fields) {
    const { error } = await supabase
        .from('negotiation_turns')
        .upsert(
            {
                id: turnId,
                session_id: sessionId,
                updated_at: new Date().toISOString(),
                ...fields,
            },
            { onConflict: 'id' }
        )
    if (error) console.error('[negotiate-background] turn status write failed:', error)
}

// ── BATNA gate (post-generation) ──────────────────────────────────────────────

function offerBreachesBATNA(offerValue, batnaValue, perspective) {
    if (typeof offerValue !== 'number' || !batnaValue || batnaValue <= 0) return false
    return perspective === 'seller' ? offerValue < batnaValue : offerValue > batnaValue
}

// ── System prompt ─────────────────────────────────────────────────────────────

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

    const techniqueBlock = (techniques || [])
        .map(
            (t) =>
                `[${(t.category || 'general').toUpperCase()}] ${t.technique_name}
  Description: ${t.description}
  When to apply: ${t.application_context || 'See description.'}
  Counter: ${t.counter_technique || 'N/A'}`
        )
        .join('\n\n')

    // FIX-4 (part): compact, capped history instead of the full raw dump
    const recentHistory = (turn_history || [])
        .slice(-HISTORY_TURNS_IN_PROMPT)
        .map((t) => ({
            turn: t.turn,
            counterparty_said: t.counterparty_message,
            our_move: t.move,
            our_offer: t.our_offer,
            we_said: t.natural_language_response,
        }))

    const worldModelBlock = `
CURRENT NEGOTIATION STATE:
- Domain: ${domain_label}
- Our current offer: ${JSON.stringify(current_offer)}
- Concession budget remaining: ${concession_remaining}% (of an original ${concession_budget}% budget, measured against our opening offer)
- BATNA value: ${batna_value} (${batna_description || 'Do not accept below this under any circumstances'})
- Opening strategy: ${opening_strategy || 'anchoring'}
- Red lines (hard stops): ${JSON.stringify(red_lines)}
- Domain variables: ${JSON.stringify(variables)}
- Domain weights: ${JSON.stringify(weights)}
- Counterparty belief model: ${JSON.stringify(counterparty_beliefs)}
- Active bluff tracker: ${JSON.stringify(bluff_tracker)}
- Recent turn history (last ${HISTORY_TURNS_IN_PROMPT}): ${JSON.stringify(recentHistory)}
`.trim()

    const concessionWarningBlock =
        concessionFlag?.warning ? `\n\nCRITICAL CONCESSION ALERT:\n${concessionFlag.flag}\n` : ''

    const modeBlock =
        mode === 'coached'
            ? 'MODE: COACHED. Your natural_language_response will be shown to a human negotiator for approval before being sent to the counterparty.'
            : 'MODE: AUTONOMOUS. Your natural_language_response will be delivered directly to the counterparty. Speak in first person as the negotiator.'

    const outputFormatBlock = `
OUTPUT FORMAT — CRITICAL:
Respond with ONLY valid JSON, no prose before or after, no markdown fences:

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

export const handler = async (event) => {
    // Netlify has already returned 202 to the client by the time this runs.
    let body
    try {
        body = JSON.parse(event.body)
    } catch {
        console.error('[negotiate-background] Invalid JSON body')
        return
    }

    const { turn_id, session_id, counterparty_message, mode = 'coached', concession_flag } = body

    if (!turn_id || !session_id || !counterparty_message) {
        console.error('[negotiate-background] turn_id, session_id and counterparty_message are required')
        return
    }

    // Mark turn as processing immediately so polling has something to find.
    await setTurnStatus(turn_id, session_id, { status: 'processing', result: null, error: null })

    try {
        // ── 1. Load world model ──────────────────────────────────────────────────
        const { data: worldModel, error: wmError } = await supabase
            .from('world_model')
            .select('*')
            .eq('session_id', session_id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (wmError) throw new Error(`World model fetch failed: ${wmError.message}`)
        if (!worldModel) throw new Error(`World model not found for session ${session_id}`)

        // ── 2. Load session + config ─────────────────────────────────────────────
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', session_id)
            .maybeSingle()

        if (sessionError) throw new Error(`Session fetch failed: ${sessionError.message}`)
        if (!session) throw new Error(`Session not found: ${session_id}`)

        let config = session.config_snapshot || {}
        if (!config.batna_value) {
            config = {
                domain_label: session.domain || 'general',
                batna_value: config.batna_value || 0,
                batna_description: config.batna_description || 'No BATNA set',
                opening_strategy: 'anchoring',
                concession_budget: config.concession_budget || 20,
                red_lines: {},
                variables: config.variables || {},
                weights: {},
                ...config,
            }
        }

        const perspective = config.variables?.perspective || 'seller'

        // ── 3. Load technique library ────────────────────────────────────────────
        const { data: techniques, error: techError } = await supabase
            .from('technique_library')
            .select('*')

        if (techError) throw new Error(`Technique library fetch failed: ${techError.message}`)

        // ── 4. Build system prompt ───────────────────────────────────────────────
        const systemPrompt = buildSystemPrompt({
            worldModel,
            config,
            techniques: techniques || [],
            concessionFlag: concession_flag || { warning: false, flag: null },
            mode,
        })

        // ── 5. Build the single user message (FIX-4) ─────────────────────────────
        // No prose assistant turns are replayed — that contradicted the JSON-only
        // contract and caused turn-2+ responses to degrade to prose.
        const transcript = session.transcript || []
        const recentDialogue = transcript
            .slice(-DIALOGUE_TURNS_IN_MESSAGE * 2)
            .map((t) =>
                t.role === 'counterparty'
                    ? `COUNTERPARTY: ${t.content}`
                    : `US: ${t.content}`
            )
            .join('\n')

        const userMessage = `${recentDialogue ? `RECENT DIALOGUE:\n${recentDialogue}\n\n` : ''}LATEST COUNTERPARTY MESSAGE:\n"${counterparty_message}"\n\nAnalyze and respond now. Output the JSON object only.`

        // ── 6. Call Claude API (FIX-2: sonnet) ───────────────────────────────────
        const claudeResponse = await anthropic.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        })

        // FIX-3: find the text block by type — content[0] can be a thinking block.
        const rawText =
            claudeResponse.content.find((b) => b.type === 'text')?.text || ''

        // ── 7. Parse and validate Claude JSON response ───────────────────────────
        let parsed
        try {
            const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim()
            parsed = JSON.parse(jsonStr)
        } catch {
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

        // ── 8. BATNA gate AFTER generation (FIX-6) ───────────────────────────────
        const proposedValue = parsed.updated_offer?.value
        if (offerBreachesBATNA(proposedValue, config.batna_value, perspective)) {
            // Do NOT persist the breaching offer or transcript. Surface the breach.
            await setTurnStatus(turn_id, session_id, {
                status: 'complete',
                result: {
                    type: 'batna_breach',
                    reason: `BATNA HARD STOP: proposed offer of ${proposedValue} breaches the BATNA ${perspective === 'seller' ? 'floor' : 'ceiling'} of ${config.batna_value}${config.batna_description ? ` (${config.batna_description})` : ''}. Draft withheld.`,
                    withheld_draft: parsed.natural_language_response,
                    natural_language_response: `I cannot proceed with this concession — it breaches our minimum acceptable threshold of ${config.batna_value}.`,
                },
            })
            return
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

        const existingBluffs = worldModel.bluff_tracker || []
        const newBluffs = parsed.bluff_probability_updates || []
        const bluffMap = new Map(existingBluffs.map((b) => [b.claim, b]))
        for (const b of newBluffs) bluffMap.set(b.claim, b)
        const updatedBluffTracker = Array.from(bluffMap.values())

        // FIX-5: concession in consistent units — percent of the OPENING offer.
        const openingOfferValue =
            (worldModel.turn_history || [])
                .map((t) => t.our_offer?.value)
                .find((v) => typeof v === 'number') ??
            (typeof worldModel.current_offer?.value === 'number'
                ? worldModel.current_offer.value
                : null)

        const offerBefore = worldModel.current_offer?.value
        const offerAfter = parsed.updated_offer?.value
        let newConcessionRemaining = worldModel.concession_remaining
        if (
            typeof offerBefore === 'number' &&
            typeof offerAfter === 'number' &&
            typeof openingOfferValue === 'number' &&
            openingOfferValue !== 0
        ) {
            const concessionMade =
                perspective === 'buyer'
                    ? offerAfter - offerBefore // buyer concedes by going up
                    : offerBefore - offerAfter // seller concedes by going down
            if (concessionMade > 0) {
                const concessionPct = (concessionMade / Math.abs(openingOfferValue)) * 100
                newConcessionRemaining = Math.max(
                    0,
                    worldModel.concession_remaining - concessionPct
                )
            }
        }

        const { error: wmUpdateError } = await supabase
            .from('world_model')
            .update({
                current_offer: parsed.updated_offer || worldModel.current_offer,
                concession_remaining: newConcessionRemaining,
                counterparty_beliefs:
                    parsed.updated_counterparty_beliefs || worldModel.counterparty_beliefs,
                bluff_tracker: updatedBluffTracker,
                turn_history: updatedTurnHistory,
                updated_at: new Date().toISOString(),
            })
            .eq('session_id', session_id)

        if (wmUpdateError) {
            console.error('[negotiate-background] World model update failed:', wmUpdateError)
        }

        // ── 10. Update session transcript ────────────────────────────────────────
        const updatedTranscript = [
            ...transcript,
            {
                role: 'counterparty',
                content: counterparty_message,
                timestamp: new Date().toISOString(),
            },
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

        // ── 11. Write final result for the poller ────────────────────────────────
        await setTurnStatus(turn_id, session_id, {
            status: 'complete',
            result: {
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
            },
        })
    } catch (err) {
        console.error('[negotiate-background]', err)
        await setTurnStatus(turn_id, session_id, {
            status: 'error',
            error: err.message,
        })
    }
}
