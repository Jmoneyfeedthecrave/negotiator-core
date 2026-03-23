/**
 * Netlify Function: hume-config
 * POST /api/hume-config
 * Creates a Hume EVI v3 configuration for a negotiation session.
 * EVI v3 API — uses voice IDs from the Voice Library, not name strings.
 *
 * ITO voice ID (EVI 3 clone): f60ecf9e-ff1e-4bae-9206-dba7c653a69e
 * KORA voice ID (EVI 3 clone): 59cfc7ab-e945-43de-ad1a-471daa379c67
 */

import { getSupabaseAdmin, requireAuth, serviceError, errResponse } from './fnUtils.js'

let supabase
function getDB() { return (supabase ??= getSupabaseAdmin()) }
const HUME_API_KEY = process.env.HUME_API_KEY


// ── Build ARCHI's voice negotiation system prompt ─────────────────────────────
function buildVoiceSystemPrompt(ourPosition, counterpartyName, learnedPatterns = []) {
    const patternBlock = learnedPatterns.length > 0
        ? `\nYOUR BEST LEARNED PATTERNS (apply these tactics):\n${learnedPatterns.slice(0, 8).map(p =>
            `• [${p.domain}] ${p.tactic_used}: ${p.lesson}`).join('\n')}`
        : ''

    const positionBlock = ourPosition ? `
YOUR NEGOTIATING POSITION:
- Goal: ${ourPosition.goal || 'Not specified'}
- Ideal outcome: ${ourPosition.ideal_outcome || ourPosition.goal || 'Not specified'}
- Walk-away (BATNA): ${ourPosition.walkaway || 'Not specified — do not reveal'}
- Concessions available: ${ourPosition.concessions_available || 'None stated'}
- Hard constraints: ${ourPosition.constraints || 'None stated'}
- Desired tone: ${ourPosition.tone || 'professional and confident'}` : ''

    return `You are ARCHI, an expert professional negotiation advisor conducting a LIVE VOICE NEGOTIATION right now.

COUNTERPARTY: ${counterpartyName || 'Unknown'}
${positionBlock}

PROFESSIONAL NEGOTIATION APPROACH:
1. You are speaking DIRECTLY to the counterparty. Speak in first person.
2. Use strategic SILENCE — pause naturally after asking questions. Do not fill silence.
3. Listen for emotional cues in their voice. Note stress, hesitation, excitement.
4. Match their conversational energy — be warm when they're open, firm when they push.
5. Maintain BATNA: ${ourPosition?.walkaway || 'the minimum acceptable terms'}
6. Use calibrated questions: "How" and "What" questions, not "Why."
7. If they ask something you'd rather not answer: "That's a great point — what I can tell you is..."
8. When you sense urgency or stress in their voice, slow down. It signals they need the deal.
9. End each exchange with a question to maintain conversational control.

COMMUNICATION TACTICS:
- Mirror their last words as a question to encourage elaboration
- Acknowledge concerns: "It sounds like the timeline is important to you."
- Work through offers methodically using the Ackerman method
- If they go silent after an offer: WAIT. Do not speak first.
- If they use pressure tactics: stay calm, slower pace, lower volume
${patternBlock}

Remember: You are ARCHI. You are negotiating RIGHT NOW. Every word matters. Work toward the best possible outcome for your client.`
}

// ── Fetch top learned patterns ────────────────────────────────────────────────
async function fetchLearnedPatterns() {
    try {
        const { data } = await getDB()
            .from('learned_patterns')
            .select('domain, tactic_used, lesson, confidence_score')
            .order('confidence_score', { ascending: false })
            .limit(10)
        return data || []
    } catch { return [] }
}

// ── Create Hume EVI v3 prompt ─────────────────────────────────────────────────
async function createHumePrompt(systemPrompt, name) {
    const res = await fetch('https://api.hume.ai/v0/evi/prompts', {
        method: 'POST',
        headers: {
            'X-Hume-Api-Key': HUME_API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, text: systemPrompt }),
    })
    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Hume prompt creation failed (${res.status}): ${err}`)
    }
    return res.json()
}

// ── Create Hume EVI v3 config ─────────────────────────────────────────────────
async function createHumeConfig(promptId, configName) {
    const payload = {
        evi_version: '3',
        name: configName,
        prompt: { id: promptId },
        // No voice ID — use Hume account default to avoid invalid voice errors
    }

    const res = await fetch('https://api.hume.ai/v0/evi/configs', {
        method: 'POST',
        headers: {
            'X-Hume-Api-Key': HUME_API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    })
    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Hume config creation failed (${res.status}): ${err}`)
    }
    return res.json()
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
    const authErr = requireAuth(event); if (authErr) return authErr

    let body
    try { body = JSON.parse(event.body || '{}') } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    const { session_id, our_position, counterparty_name, domain } = body

    if (!session_id) return { statusCode: 400, body: JSON.stringify({ error: 'session_id required' }) }

    if (!HUME_API_KEY) {
        console.error('[hume-config] HUME_API_KEY not set')
        return errResponse(serviceError('hume', 'HUME_API_KEY not configured'))
    }

    try {
        const db = getDB()
        const learnedPatterns = await fetchLearnedPatterns()
        const systemPrompt = buildVoiceSystemPrompt(our_position, counterparty_name, learnedPatterns)
        const configName = `ARCHI-${(counterparty_name || session_id).slice(0, 30)}-${Date.now()}`

        // Step 1: Create the prompt
        const prompt = await createHumePrompt(systemPrompt, configName)
        console.log('[hume-config] Prompt created:', prompt.id)

        // Step 2: Create the config referencing the prompt
        const humeConfig = await createHumeConfig(prompt.id, configName)
        console.log('[hume-config] Config created:', humeConfig.id)

        // Step 3: Store on voice session
        await db
            .from('voice_sessions')
            .update({
                hume_config_id: humeConfig.id,
                hume_prompt_id: prompt.id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', session_id)

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                hume_config_id: humeConfig.id,
                hume_prompt_id: prompt.id,
                config_name: configName,
            }),
        }
    } catch (err) {
        console.error('[hume-config] error:', err.message)
        return errResponse(serviceError('hume', 'Hume EVI config creation failed', err))
    }
}
