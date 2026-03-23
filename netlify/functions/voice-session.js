/**
 * Netlify Function: voice-session
 * POST /api/voice-session  — create or update a voice session
 * GET  /api/voice-session?id=xxx — fetch a session
 */

import Anthropic from '@anthropic-ai/sdk'
$args[0].Groups[1].Value + $args[0].Groups[2].Value + ", handleOptions" + $args[0].Groups[3].Value

let _supabase
function getDB() { return (_supabase ??= getSupabaseAdmin()) }
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
const HUME_API_KEY = process.env.HUME_API_KEY

// -- Fetch transcript from Hume API --------------------------------------------
async function fetchHumeTranscript(humeConfigId, humeChatId) {
    if (!humeChatId) return null
    try {
        const res = await fetch(`https://api.hume.ai/v0/evi/chats/${humeChatId}`, {
            headers: { 'X-Hume-Api-Key': HUME_API_KEY },
        })
        if (!res.ok) return null
        const data = await res.json()
        return data
    } catch { return null }
}

// -- AI debrief of the call -------------------------------------------------
async function analyzeCall(session, emailThread) {
    const turns = (session.transcript || [])
    const transcriptText = turns
        .map(t => `[${t.role === 'assistant' ? 'ARCHI' : 'COUNTERPARTY'}]: ${t.content}`)
        .join('\n\n')

    // Cross-reference with email thread if linked
    let emailContext = ''
    if (emailThread) {
        const { data: emails } = await getDB()
            .from('emails')
            .select('direction, body, claude_analysis')
            .eq('thread_id', emailThread.id)
            .order('created_at', { ascending: true })
            .limit(10)

        if (emails?.length) {
            emailContext = `\n\nPRIOR EMAIL THREAD (cross-reference for contradictions):\n${emails.map(e =>
                `[${e.direction === 'inbound' ? 'COUNTERPARTY EMAIL' : 'ARCHI EMAIL'}]: ${e.body?.slice(0, 400)}`
            ).join('\n\n')}`
        }
    }

    // Build emotion summary
    const emotionSummary = (session.emotion_timeline || []).slice(0, 20)
        .map(e => `t=${Math.round(e.ts_ms / 1000)}s: ${e.speaker} — ${e.top_emotion} (${Math.round(e.score * 100)}%)`)
        .join('\n')

    const prompt = `You are a master negotiation coach reviewing a completed voice negotiation conducted by ARCHI.

CALL DURATION: ${session.duration_ms ? `${Math.round(session.duration_ms / 1000)}s` : 'Unknown'}
COUNTERPARTY: ${session.counterparty_name || 'Unknown'}
OUR GOAL: ${session.our_position?.goal || 'Not specified'}
OUR BATNA: ${session.our_position?.walkaway || 'Not specified'}

EMOTION TIMELINE (key moments):
${emotionSummary || 'No emotion data available'}

VOICE TRANSCRIPT:
${transcriptText || 'No transcript available'}
${emailContext}

Analyze this negotiation and provide a comprehensive debrief. ${emailThread ? 'Pay special attention to any CONTRADICTIONS between what they said in emails vs. on the call — these are key deception signals.' : ''}

Respond with valid JSON only:
{
  "negotiation_score": 0-100,
  "outcome_assessment": "win|partial|loss|ongoing",
  "key_moments": [
    {"timestamp_s": 0, "moment": "description", "significance": "why this mattered"}
  ],
  "emotion_insights": [
    {"insight": "what their emotional signals revealed", "implication": "negotiation implication"}
  ],
  "techniques_they_used": ["technique name"],
  "techniques_archi_used": ["technique name"],
  "email_contradictions": [
    {"they_said_in_email": "...", "they_said_on_call": "...", "bluff_probability": 0.0}
  ],
  "what_worked": "what ARCHI did effectively",
  "what_to_do_next": "recommended next move",
  "patterns": [
    {
      "situation_type": "one-line trigger description",
      "tactic_used": "specific tactic",
      "what_worked": "what worked",
      "lesson": "reusable insight",
      "outcome_type": "win|partial|loss",
      "confidence_score": 0.80
    }
  ]
}`

    const res = await anthropic.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
    })

    const raw = res.content[0]?.text || ''
    try {
        const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
        return JSON.parse(match ? match[1].trim() : raw.trim())
    } catch {
        console.error('[voice-session] analyzeCall JSON parse failed — raw:', raw.slice(0, 300))
        return {
            negotiation_score: 50,
            outcome_assessment: 'unknown',
            key_moments: [],
            emotion_insights: [],
            techniques_they_used: [],
            techniques_archi_used: [],
            email_contradictions: [],
            what_worked: 'Analysis unavailable — Claude response was not valid JSON.',
            what_to_do_next: 'Review the call transcript manually.',
            patterns: [],
        }
    }
}

// -- Main handler --------------------------------------------------------------
export const handler = async (event) => {
    const method = event.httpMethod
    if (event.httpMethod === 'OPTIONS') return handleOptions()
    const authErr = requireAuth(event); if (authErr) return authErr

    // GET — fetch a session
    if (method === 'GET') {
        const id = event.queryStringParameters?.id
        const all = event.queryStringParameters?.all
        if (all) {
            const { data } = await getDB()
                .from('voice_sessions')
                .select('*, email_threads(subject, counterparty_email)')
                .order('created_at', { ascending: false })
                .limit(50)
            return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || []) }
        }
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) }
        const { data } = await getDB()
            .from('voice_sessions')
            .select('*, email_threads(subject, counterparty_email, our_position)')
            .eq('id', id).single()
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }
    }

    if (method !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    let body
    try { body = JSON.parse(event.body || '{}') } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    const { action } = body

    // -- CREATE session -------------------------------------------------------
    if (action === 'create') {
        const { title, counterparty_name, our_position, thread_id } = body
        const { data, error } = await getDB()
            .from('voice_sessions')
            .insert({
                title: title || `Call with ${counterparty_name || 'Counterparty'}`,
                counterparty_name,
                our_position: our_position || {},
                thread_id: thread_id || null,
                status: 'setup',
            })
            .select().single()
        if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
    }

    // -- UPDATE transcript / status -------------------------------------------
    if (action === 'update') {
        const { session_id, transcript, emotion_timeline, status, hume_chat_id, duration_ms } = body
        const updates = { updated_at: new Date().toISOString() }
        if (transcript !== undefined) {
            updates.transcript = transcript
            updates.full_text = transcript.map(t => t.content).join(' ')
        }
        if (emotion_timeline !== undefined) updates.emotion_timeline = emotion_timeline
        if (status !== undefined) updates.status = status
        if (hume_chat_id !== undefined) updates.hume_chat_id = hume_chat_id
        if (duration_ms !== undefined) updates.duration_ms = duration_ms

        const { error } = await getDB().from('voice_sessions').update(updates).eq('id', session_id)
        if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
        return { statusCode: 200, body: JSON.stringify({ success: true }) }
    }

    // -- ANALYZE call — run debrief -------------------------------------------
    if (action === 'analyze') {
        const { session_id } = body
        const { data: session } = await getDB()
            .from('voice_sessions')
            .select('*, email_threads(*)')
            .eq('id', session_id).single()

        if (!session) return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) }

        try {
            const analysis = await analyzeCall(session, session.email_threads)

            // Save patterns to learned_patterns
            const patterns = (analysis.patterns || []).map(p => ({
                source_type: 'own_negotiation',
                domain: session.email_threads?.domain || 'Voice Negotiation',
                situation_type: p.situation_type,
                tactic_used: p.tactic_used,
                what_worked: p.what_worked,
                lesson: p.lesson,
                outcome_type: p.outcome_type || 'unknown',
                source_thread_id: session.thread_id || null,
                confidence_score: p.confidence_score || 0.75,
            }))

            if (patterns.length > 0) {
                await getDB().from('learned_patterns').insert(patterns)
            }

            await getDB().from('voice_sessions').update({
                analysis,
                status: 'analyzed',
                lessons_extracted: patterns.length,
                updated_at: new Date().toISOString(),
            }).eq('id', session_id)

            // -- REVERSE BRIDGE: Write voice intelligence back to email thread ------
            // Enriches the counterparty profile so future email drafts have full voice context
            if (session.thread_id) {
                try {
                    const { data: currentThread } = await getDB()
                        .from('email_threads')
                        .select('counterparty_profile')
                        .eq('id', session.thread_id)
                        .single()

                    const existingProfile = currentThread?.counterparty_profile || {}
                    const voiceProfile = {
                        ...existingProfile,
                        // Voice-derived signals (merged, not overwriting existing email intelligence)
                        voice_techniques_they_used: [
                            ...new Set([
                                ...(existingProfile.voice_techniques_they_used || []),
                                ...(analysis.techniques_they_used || []),
                            ])
                        ],
                        voice_emotion_signatures: [
                            ...new Set([
                                ...(existingProfile.voice_emotion_signatures || []),
                                ...(analysis.emotion_insights || []).map(e => e.insight),
                            ])
                        ],
                        voice_contradictions_detected: [
                            ...new Set([
                                ...(existingProfile.voice_contradictions_detected || []),
                                ...(analysis.email_contradictions || []).map(c => c.they_said_on_call),
                            ])
                        ],
                        last_call_score: analysis.negotiation_score,
                        last_call_outcome: analysis.outcome_assessment,
                        last_call_next_move: analysis.what_to_do_next,
                        last_call_date: new Date().toISOString(),
                    }

                    await getDB()
                        .from('email_threads')
                        .update({ counterparty_profile: voiceProfile })
                        .eq('id', session.thread_id)

                    console.log(`[voice-session] Wrote voice intel back to email thread ${session.thread_id}`)
                } catch (profileErr) {
                    console.error('[voice-session] profile writeback failed (non-blocking):', profileErr.message)
                }
            }

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, analysis, lessons_extracted: patterns.length }),
            }
        } catch (err) {
            console.error('[voice-session analyze]', err)
            return errResponse(serviceError('claude', 'Voice session analysis failed', err))
        }
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) }
}
