/**
 * Netlify Function: simulate
 * POST /api/simulate
 * Runs a full Claude-vs-Claude negotiation session for one persona.
 * Instance A = our negotiator (uses full technique library + world model)
 * Instance B = counterparty persona (uses persona system prompt)
 *
 * Body: {
 *   domain: string,
 *   persona_id: string | 'random',
 *   max_turns?: number,         // default 10
 *   batna_value?: number,
 *   target_value?: number,      // our utility target
 *   opening_offer?: number,
 * }
 *
 * Returns: {
 *   session_id, persona_id, persona_name,
 *   outcome: 'won' | 'lost' | 'batna_breach' | 'stalemate',
 *   final_value, win_vs_target,
 *   turns_taken, transcript,
 *   tactic_summary: { most_used_tactic, key_moments }
 * }
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

// ── Inline PERSONAS (Netlify functions cannot import from src/) ────────────────
const PERSONAS = [
    { id: 'anchor_bomber', name: 'Anchor Bomber', system_prompt: `You are a negotiator playing the Anchor Bomber persona. Always open with the most extreme anchor you can justify — far outside any reasonable range. State it with total confidence. Move very slowly, making tiny concessions only when pressed hard. Act offended when the counterparty offers anything near fair value.` },
    { id: 'nibbler', name: 'Nibbler', system_prompt: `You are a negotiator playing the Nibbler persona. Get close to agreement on main terms, then introduce small additional requests one at a time. Each ask should seem minor. Use phrases like "just one more small thing". Exploit the counterparty's commitment to extract extras.` },
    { id: 'flincher', name: 'Flincher', system_prompt: `You are a negotiator playing the Flincher persona. React with visible shock and disbelief to every offer. "I have to be honest, that number shocked me." Make the counterparty feel their offer is unreasonable even when fair. Use emotional reactions to pressure concessions before making counteroffers.` },
    { id: 'good_cop_bad_cop', name: 'Good Cop Bad Cop', system_prompt: `You are a negotiator playing Good Cop Bad Cop alone. Reference a fictional aggressive partner: "My colleague thinks we should walk away, but I personally want to find a deal." Alternate between being demanding and sympathetic to create artificial good-faith pressure.` },
    { id: 'time_pressurer', name: 'Time Pressurer', system_prompt: `You are a negotiator playing the Time Pressurer persona. Create artificial urgency: fake deadlines, competing offers, expiring board approvals. "I need an answer by end of day." "We have a competing offer we must respond to." Make delay feel like losing the deal.` },
    { id: 'reluctant_buyer', name: 'Reluctant Buyer', system_prompt: `You are a negotiator playing the Reluctant Buyer persona. Show no enthusiasm. Act as if this deal barely interests you and you have plenty of alternatives. "I suppose that could work if the price were right." Make the counterparty pursue you and offer concessions to win your lukewarm interest.` },
    { id: 'logroller', name: 'Logroller', system_prompt: `You are a negotiator playing the Logroller persona. Never concede on a single issue in isolation. Always link issues into package deals. "If you move on price, I can move on timeline." Connect all variables together to extract maximum total value.` },
    { id: 'information_miner', name: 'Information Miner', system_prompt: `You are a negotiator playing the Information Miner persona. Delay making any offers while asking probing questions: "What is driving that number?", "What happens if this falls through?", "How flexible is your timeline?" Map the counterparty's full situation before committing to any position.` },
    { id: 'walkaway_bluffer', name: 'Walkaway Bluffer', system_prompt: `You are a negotiator playing the Walkaway Bluffer persona. Regularly threaten to end negotiations even though you actually need this deal. "I think we need to step back from this." Sound completely serious. Return to the table only after the counterparty offers a concession.` },
    { id: 'rational_actor', name: 'Rational Actor', system_prompt: `You are a negotiator playing the Rational Actor persona. Base all positions on objective criteria: market data, industry benchmarks, comparable transactions. Reject emotional arguments. Only respond to logic and evidence. Do not use manipulation tactics.` },
    { id: 'maniac', name: 'Maniac', system_prompt: `You are a negotiator playing the Maniac persona. Be completely unpredictable. Shift positions dramatically without explanation. Make sudden extreme demands. Occasionally make a large concession then immediately retract it. Create chaos so the counterparty cannot model your behavior.` },
    { id: 'rock', name: 'Rock', system_prompt: `You are a negotiator playing the Rock persona. State your opening position clearly once, then never deviate from it regardless of arguments or creative solutions offered. Simply repeat: "Our position remains X. We are not able to move from this." Show zero flexibility.` },
    { id: 'calling_station', name: 'Calling Station', system_prompt: `You are a negotiator playing the Calling Station persona. Be largely passive and agreeable. Accept most terms without resistance. Occasionally raise a mild, vague objection ("I am just not sure about this one element") without being able to explain why.` },
    { id: 'shark', name: 'Shark', system_prompt: `You are a negotiator playing the Shark persona. You are world-class. Combine aggressive anchoring, strategic mirroring, emotional labeling, and calibrated questions fluidly. Always control the frame. Study concession patterns and exploit any weakness. Stay calm and in control at all times.` },
    { id: 'tilted_player', name: 'Tilted Player', system_prompt: `You are a negotiator playing the Tilted Player persona. Start reasonable and professional. As pressure increases, gradually become more emotional and erratic. When significantly pressured, either escalate demands irrationally OR make impulsive concessions just to relieve tension.` },
    { id: 'smooth_liar', name: 'Smooth Liar', system_prompt: `You are a negotiator playing the Smooth Liar persona. Fabricate facts, competing offers, constraints, and your BATNA — and state them with complete conviction. "We already have a competing offer at this price." Deliver all fabrications smoothly and confidently.` },
    { id: 'rushed_closer', name: 'Rushed Closer', system_prompt: `You are a negotiator playing the Rushed Closer persona. Push continuously to close the deal fast. "I think we are close enough, let us agree now." "Can we shake on this today?" Resist deliberate examination of terms. Get to a handshake as quickly as possible.` },
]

function getPersona(personaId) {
    if (personaId === 'random') return PERSONAS[Math.floor(Math.random() * PERSONAS.length)]
    return PERSONAS.find(p => p.id === personaId) || PERSONAS[0]
}

// ── Negotiator A system prompt (our agent) ────────────────────────────────────
function buildNegotiatorAPrompt(domain, batnaValue, targetValue, openingOffer, techniques, turnHistory) {
    const techniqueBlock = techniques.slice(0, 8).map(t => `[${t.category.toUpperCase()}] ${t.technique_name}: ${t.description}`).join('\n')
    return `You are an elite AI negotiator (Instance A) in a ${domain} negotiation simulation.

OBJECTIVE: Reach the best possible deal. Target value: ${targetValue}. BATNA (walk-away): ${batnaValue}. Opening position: ${openingOffer}.

KEY TECHNIQUES:
${techniqueBlock}

RULES:
- Never accept below BATNA of ${batnaValue}
- Always make a concrete offer or counteroffer each turn
- Track the counterparty's patterns and adapt

OUTPUT: Respond with JSON only:
{
  "technique_used": "name of technique you applied",
  "reasoning": "brief strategic reasoning",
  "response": "your exact verbal response to the counterparty",
  "my_current_offer": <number or null>,
  "deal_accepted": <true/false>,
  "walk_away": <true/false>
}`
}

// ── Counterparty B system prompt (persona) ────────────────────────────────────
function buildCounterpartyBPrompt(persona, domain, targetValue) {
    return `${persona.system_prompt}

CONTEXT: You are negotiating a ${domain} deal. Your target outcome is ${targetValue}. 

RULES:
- Always stay in character as your persona
- Make concrete offers or counteroffers each turn
- Respond naturally in negotiation dialogue

OUTPUT: Respond with JSON only:
{
  "response": "your exact verbal response",
  "my_current_offer": <number or null>,
  "deal_accepted": <true/false>,
  "walk_away": <true/false>
}`
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) } }

    const {
        domain = 'General Business Negotiation',
        persona_id = 'random',
        max_turns: rawMaxTurns = 4,
        batna_value = 80,
        target_value = 100,
        opening_offer = 120,
    } = body

    // Hard cap — Netlify functions timeout at 26s; 2 Claude calls × 5 turns ≈ 20s max
    const max_turns = Math.min(Number(rawMaxTurns) || 4, 5)

    const persona = getPersona(persona_id)

    try {
        // Load technique library
        const { data: techniques } = await supabase.from('technique_library').select('*')

        // Create session in Supabase
        const { data: session } = await supabase
            .from('sessions')
            .insert({
                domain,
                transcript: [],
                config_snapshot: { batna_value, target_value, opening_offer, persona_id: persona.id, mode: 'simulation' },
            })
            .select().single()

        const sessionId = session.id
        const conversationA = [] // messages array for Instance A
        const conversationB = [] // messages array for Instance B
        const transcript = []

        let currentOfferA = opening_offer
        let currentOfferB = null
        let dealValue = null
        let outcome = 'stalemate'
        let turnsCompleted = 0

        // Instance A opens
        const openingStatement = `We are opening at ${opening_offer} for this ${domain} deal. We believe this is a fair starting point and look forward to reaching a mutually beneficial agreement.`
        conversationB.push({ role: 'user', content: openingStatement })
        transcript.push({ turn: 0, speaker: 'negotiator_a', content: openingStatement, offer: opening_offer })

        for (let turn = 1; turn <= max_turns; turn++) {
            turnsCompleted = turn

            // ── Instance B responds (counterparty persona) ─────────────────────────
            const bSystemPrompt = buildCounterpartyBPrompt(persona, domain, target_value * 0.85)
            const bResponse = await anthropic.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 512,
                system: bSystemPrompt,
                messages: conversationB,
            })

            let bParsed
            try {
                const bText = bResponse.content[0]?.text || ''
                const bMatch = bText.match(/```(?:json)?\s*([\s\S]*?)```/)
                bParsed = JSON.parse(bMatch ? bMatch[1].trim() : bText.trim())
            } catch {
                bParsed = { response: bResponse.content[0]?.text || 'No response', my_current_offer: null, deal_accepted: false, walk_away: false }
            }

            if (bParsed.my_current_offer) currentOfferB = bParsed.my_current_offer
            transcript.push({ turn, speaker: 'counterparty_b', persona: persona.name, content: bParsed.response, offer: currentOfferB })

            if (bParsed.deal_accepted) { dealValue = currentOfferA; outcome = dealValue >= batna_value ? 'won' : 'batna_breach'; break }
            if (bParsed.walk_away) { outcome = 'stalemate'; break }

            // Add B's response to A's message history
            conversationA.push({ role: 'user', content: bParsed.response })

            // ── Instance A responds (our negotiator) ───────────────────────────────
            const aSystemPrompt = buildNegotiatorAPrompt(domain, batna_value, target_value, opening_offer, techniques || [], transcript)
            const aResponse = await anthropic.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 512,
                system: aSystemPrompt,
                messages: conversationA,
            })

            let aParsed
            try {
                const aText = aResponse.content[0]?.text || ''
                const aMatch = aText.match(/```(?:json)?\s*([\s\S]*?)```/)
                aParsed = JSON.parse(aMatch ? aMatch[1].trim() : aText.trim())
            } catch {
                aParsed = { technique_used: 'unknown', reasoning: '', response: aResponse.content[0]?.text || '', my_current_offer: currentOfferA, deal_accepted: false, walk_away: false }
            }

            if (aParsed.my_current_offer) currentOfferA = aParsed.my_current_offer
            conversationA.push({ role: 'assistant', content: aParsed.response })
            conversationB.push({ role: 'user', content: aParsed.response })
            transcript.push({ turn, speaker: 'negotiator_a', technique: aParsed.technique_used, reasoning: aParsed.reasoning, content: aParsed.response, offer: currentOfferA })

            if (aParsed.deal_accepted && currentOfferB) {
                dealValue = currentOfferB
                outcome = dealValue >= batna_value ? 'won' : 'batna_breach'
                break
            }
            if (aParsed.walk_away) { outcome = 'stalemate'; break }

            // Check if offers have converged
            if (currentOfferA !== null && currentOfferB !== null) {
                const gap = Math.abs(currentOfferA - currentOfferB)
                if (gap <= (target_value * 0.02)) { // within 2% — call it a deal
                    dealValue = (currentOfferA + currentOfferB) / 2
                    outcome = dealValue >= batna_value ? 'won' : 'batna_breach'
                    break
                }
            }
        }

        // Compute win_vs_target
        const winVsTarget = dealValue !== null && target_value > 0
            ? ((dealValue - batna_value) / (target_value - batna_value)) * 100
            : null

        // Update session with outcome
        await supabase.from('sessions').update({
            transcript,
            outcome,
            win_vs_target: winVsTarget,
        }).eq('id', sessionId)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                persona_id: persona.id,
                persona_name: persona.name,
                outcome,
                final_value: dealValue,
                win_vs_target: winVsTarget,
                turns_taken: turnsCompleted,
                batna_value,
                target_value,
                transcript,
            }),
        }
    } catch (err) {
        console.error('[simulate]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
