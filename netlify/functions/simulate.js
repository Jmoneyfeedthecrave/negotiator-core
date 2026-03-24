/**
 * Netlify Function: simulate
 * POST /api/simulate
 * Runs a full Claude-vs-Claude negotiation session for one persona.
 * Instance A = our negotiator (uses full learned pattern library)
 * Instance B = counterparty persona (uses persona system prompt)
 * Post-simulation: auto-reflects and creates new learned patterns.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin, MODEL_HAIKU, PERSONAS } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })


function getPersona(personaId) {
    if (personaId === 'random') return PERSONAS[Math.floor(Math.random() * PERSONAS.length)]
    return PERSONAS.find(p => p.id === personaId) || PERSONAS[0]
}

// -- Negotiator A system prompt (our agent) ------------------------------------
function buildNegotiatorAPrompt(domain, batnaValue, targetValue, openingOffer, techniques, turnHistory) {
    const techniqueBlock = techniques.slice(0, 12).map(t => `[${(t.category || 'learned').toUpperCase()}] ${t.technique_name}: ${t.description}`).join('\n')
    return `You are an elite AI negotiator (Instance A) in a ${domain} negotiation simulation.

OBJECTIVE: Reach the best possible deal. Target value: ${targetValue}. BATNA (walk-away): ${batnaValue}. Opening position: ${openingOffer}.

LEARNED PATTERNS (apply these first):
${techniqueBlock}

RULES:
- Never accept below BATNA of ${batnaValue}
- Always make a concrete offer or counteroffer each turn
- Track the counterparty's patterns and adapt
- Reference which learned patterns you applied

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

// -- Counterparty B system prompt (persona) ------------------------------------
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

    const max_turns = Math.min(Number(rawMaxTurns) || 4, 8)
    const persona = getPersona(persona_id)

    try {
        // Pull learned patterns from DB  ARCHI uses its real knowledge
        let techniques = []
        try {
            const { data: learnedPatterns } = await getDB()
                .from('learned_patterns')
                .select('id, tactic_used, lesson, situation_type, confidence_score')
                .order('confidence_score', { ascending: false })
                .limit(15)
            if (learnedPatterns && learnedPatterns.length > 0) {
                techniques = learnedPatterns.map(p => ({
                    category: 'learned',
                    technique_name: p.tactic_used,
                    description: `${p.lesson} (conf: ${p.confidence_score})`,
                    id: p.id,
                }))
            }
        } catch { /* fallback to defaults */ }

        if (techniques.length === 0) {
            techniques = [
                { category: 'anchoring', technique_name: 'Extreme Anchor', description: 'Open with a bold extreme offer to set the range.' },
                { category: 'reframing', technique_name: 'Value Reframe', description: 'Shift focus from price to total value.' },
                { category: 'silence', technique_name: 'Strategic Silence', description: 'Use silence after an offer to create pressure.' },
            ]
        }

        const { data: session } = await getDB()
            .from('sessions')
            .insert({
                domain,
                transcript: [],
                config_snapshot: { batna_value, target_value, opening_offer, persona_id: persona.id, mode: 'simulation' },
            })
            .select().single()

        const sessionId = session.id
        const conversationA = []
        const conversationB = []
        const transcript = []
        const techniquesUsed = []

        let currentOfferA = opening_offer
        let currentOfferB = null
        let dealValue = null
        let outcome = 'stalemate'
        let turnsCompleted = 0

        const openingStatement = `We are opening at ${opening_offer} for this ${domain} deal. We believe this is a fair starting point and look forward to reaching a mutually beneficial agreement.`
        conversationB.push({ role: 'user', content: openingStatement })
        transcript.push({ turn: 0, speaker: 'negotiator_a', content: openingStatement, offer: opening_offer })

        for (let turn = 1; turn <= max_turns; turn++) {
            turnsCompleted = turn
            // First-person perspective: each conversation array is owned by one party.
            // Self = assistant, counterparty = user. Never push your own response as user
            // in your own array  that breaks Claude's alternation requirement.

            // Instance B responds
            const bSystemPrompt = buildCounterpartyBPrompt(persona, domain, target_value * 0.85)
            const bResponse = await anthropic.messages.create({
                model: MODEL_HAIKU,
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

            // B responded  record that as assistant in B's conversation, then A hears it as user
            conversationB.push({ role: 'assistant', content: bParsed.response })
            conversationA.push({ role: 'user', content: bParsed.response })

            // Instance A responds with learned patterns
            const aSystemPrompt = buildNegotiatorAPrompt(domain, batna_value, target_value, opening_offer, techniques, transcript)
            const aResponse = await anthropic.messages.create({
                model: MODEL_HAIKU,
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

            if (aParsed.technique_used) techniquesUsed.push(aParsed.technique_used)
            if (aParsed.my_current_offer) currentOfferA = aParsed.my_current_offer
            // A responded  record as assistant in A's conversation, then B hears it as user
            conversationA.push({ role: 'assistant', content: aParsed.response })
            conversationB.push({ role: 'user', content: aParsed.response })
            transcript.push({ turn, speaker: 'negotiator_a', technique: aParsed.technique_used, reasoning: aParsed.reasoning, content: aParsed.response, offer: currentOfferA })

            if (aParsed.deal_accepted && currentOfferB) {
                dealValue = currentOfferB
                outcome = dealValue >= batna_value ? 'won' : 'batna_breach'
                break
            }
            if (aParsed.walk_away) { outcome = 'stalemate'; break }

            if (currentOfferA !== null && currentOfferB !== null) {
                const gap = Math.abs(currentOfferA - currentOfferB)
                if (gap <= (target_value * 0.02)) {
                    dealValue = (currentOfferA + currentOfferB) / 2
                    outcome = dealValue >= batna_value ? 'won' : 'batna_breach'
                    break
                }
            }
        }

        const winVsTarget = dealValue !== null && target_value > 0
            ? ((dealValue - batna_value) / (target_value - batna_value)) * 100
            : null

        await getDB().from('sessions').update({
            transcript, outcome, win_vs_target: winVsTarget,
        }).eq('id', sessionId)

        // -- POST-SIMULATION REFLECTION (Autonomous Learning) -------------
        try {
            const simTranscript = transcript.map(t =>
                `[Turn ${t.turn}] ${t.speaker === 'negotiator_a' ? 'ARCHI' : persona.name}: ${t.content?.slice(0, 300) || ''}${t.technique ? ` [technique: ${t.technique}]` : ''}`
            ).join('\n')

            const reflectPrompt = `Analyze this negotiation simulation and extract 2-4 lessons.
DOMAIN: ${domain} | PERSONA: ${persona.name} | OUTCOME: ${outcome} | DEAL VALUE: ${dealValue || 'no deal'}
TRANSCRIPT:\n${simTranscript.slice(0, 2000)}

Respond with valid JSON only:
{"patterns":[{"situation_type":"trigger","tactic_used":"tactic","what_worked":"text","what_failed":"text or null","lesson":"key insight","confidence_score":0.65}]}`

            const reflectRes = await anthropic.messages.create({
                model: MODEL_HAIKU,
                max_tokens: 800,
                messages: [{ role: 'user', content: reflectPrompt }],
            })

            let simPatterns = []
            try {
                const raw = reflectRes.content[0]?.text || ''
                const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
                const parsed = JSON.parse(match ? match[1].trim() : raw.trim())
                simPatterns = parsed.patterns || []
            } catch { /* ignore */ }

            if (simPatterns.length > 0) {
                const rows = simPatterns.map(p => ({
                    source_type: 'simulation',
                    domain,
                    situation_type: p.situation_type,
                    tactic_used: p.tactic_used,
                    what_worked: p.what_worked,
                    what_failed: p.what_failed || null,
                    lesson: p.lesson,
                    outcome_type: outcome,
                    confidence_score: p.confidence_score || 0.55,
                }))
                await getDB().from('learned_patterns').insert(rows)
                console.log(`[simulate-reflect] ${rows.length} new patterns from sim vs ${persona.name}`)
            }
        } catch (reflectErr) {
            console.error('[simulate-reflect] non-blocking:', reflectErr.message)
        }

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
                batna_value, target_value,
                techniques_used: techniquesUsed,
                transcript,
            }),
        }
    } catch (err) {
        console.error('[simulate]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
