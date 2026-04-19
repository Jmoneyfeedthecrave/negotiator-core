/**
 * Netlify Function: initiate-negotiation
 * POST /api/initiate-negotiation
 *
 * Creates an outbound-initiated negotiation thread.
 * Flow:
 *   1. Accept counterparty details + our position brief
 *   2. Run counterparty research (fire-and-forget)
 *   3. Call Claude to draft a strategic opening email
 *   4. Save thread + draft to Supabase (status: pending_approval)
 *   5. Return draft for UI review — user approves before it sends
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { NEGOTIATION_PLAYBOOK } from './negotiationPlaybook.js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

async function fetchLearnedPatterns() {
    try {
        const { data } = await supabase
            .from('learned_patterns')
            .select('source_type, domain, situation_type, tactic_used, what_worked, lesson, outcome_type')
            .order('confidence_score', { ascending: false })
            .limit(20)
        return data || []
    } catch { return [] }
}

function buildOpeningEmailPrompt(ourPosition, counterpartyName, counterpartyEmail, threadDomain, learnedPatterns) {
    const tone = ourPosition.tone || 'professional'
    const pp = learnedPatterns.length > 0
        ? `\n\nLEARNED PATTERNS FROM PAST NEGOTIATIONS:\n${learnedPatterns.slice(0, 10).map(p =>
            `• [${p.domain}] ${p.situation_type}: ${p.lesson}`).join('\n')}`
        : ''

    return `You are an elite negotiation strategist about to write the OPENING email of a negotiation on behalf of our client.

${NEGOTIATION_PLAYBOOK}

COUNTERPARTY:
- Name/Email: ${counterpartyName || counterpartyEmail}
- Domain: ${threadDomain}

OUR POSITION:
- Goal: ${ourPosition.goal}
- Ideal outcome: ${ourPosition.ideal_outcome || ourPosition.goal}
- Walk-away / bottom line: ${ourPosition.walkaway || 'Not specified'}
- BATNA: ${ourPosition.batna || 'Not specified'}
- Concessions we can offer: ${ourPosition.concessions_available || 'Not specified'}
- Hard constraints: ${ourPosition.constraints || 'None stated'}
- Desired tone: ${tone}
- Subject: ${ourPosition.subject}${pp}

OPENING EMAIL STRATEGY:
The opening move is the most important move in any negotiation. It sets the anchor, the frame, the power dynamic, and the emotional register for everything that follows.

Apply chess thinking: what opening gambit serves us best here?
- Aggressive anchor (stake our ground high, pull them toward us)?
- Collaborative framing (build rapport, invite them to the table)?
- Information gathering (appear open, extract their position first)?
- Soft probe (low-commitment opener that preserves optionality)?

Pick the best opening based on our goals, their likely position, and the domain norms.

CRITICAL RULES:
1. Sound like a HUMAN professional, NOT an AI. No "I hope this email finds you well."
2. Do NOT reveal our walk-away or constraints
3. Do NOT be aggressive in a way that poisons the well — we want a deal
4. Strategic patience: we don't have to win in email #1
5. Length: 3–5 short paragraphs maximum. Business email, not a legal brief.

Return ONLY valid JSON (no markdown, no preamble):
{
  "subject_line": "email subject",
  "opening_email": "the full email body — plain text, no HTML",
  "opening_strategy": "1-sentence explanation of the chess move you chose",
  "predicted_response_type": "what the counterparty is most likely to reply with",
  "our_next_move_if": {
    "they_accept": "what we do if they agree to our opening",
    "they_counter": "how we respond to a counter-offer",
    "they_stall": "how we handle silence or delays"
  }
}`
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    let body
    try { body = JSON.parse(event.body || '{}') }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) } }

    const {
        counterparty_email,
        counterparty_name = '',
        our_position,          // { subject, goal, ideal_outcome, walkaway, batna, concessions_available, constraints, tone }
    } = body

    if (!counterparty_email || !our_position?.goal || !our_position?.subject) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'counterparty_email, our_position.goal, and our_position.subject are required' })
        }
    }

    try {
        const threadDomain = counterparty_email.split('@')[1] || 'unknown'
        const learnedPatterns = await fetchLearnedPatterns()

        // 1. Create the thread record
        const { data: thread, error: threadErr } = await supabase
            .from('email_threads')
            .insert({
                subject:            our_position.subject,
                counterparty_email: counterparty_email,
                domain:             threadDomain,
                mode:               'coached',
                thread_type:        'outbound',
                our_position:       our_position,
                position_confirmed: true,   // outbound: the user filled it in, so it's confirmed
                updated_at:         new Date().toISOString(),
            })
            .select().single()

        if (threadErr) throw threadErr
        const threadId = thread.id

        // 2. Trigger counterparty research (fire-and-forget)
        fetch(`${process.env.URL}/.netlify/functions/research-counterparty`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thread_id: threadId, from_email: counterparty_email, from_name: counterparty_name }),
        }).catch(err => console.error('[initiate] research fire-and-forget failed:', err.message))

        // 3. Call Claude to draft the opening email
        const prompt = buildOpeningEmailPrompt(our_position, counterparty_name, counterparty_email, threadDomain, learnedPatterns)
        const claudeRes = await anthropic.messages.create({
            model:      'claude-opus-4-7',
            max_tokens: 2000,
            messages:   [{ role: 'user', content: prompt }],
        })

        let draft = {}
        try {
            const raw = claudeRes.content[0]?.text || ''
            const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
            draft = JSON.parse(match ? match[1].trim() : raw.trim())
        } catch {
            draft = {
                subject_line:   our_position.subject,
                opening_email:  claudeRes.content[0]?.text || '',
                opening_strategy: 'Standard professional opening',
            }
        }

        // 4. Save the draft outbound email (pending_approval — not sent yet)
        const { data: savedEmail } = await supabase
            .from('emails')
            .insert({
                thread_id:    threadId,
                direction:    'outbound',
                from_email:   process.env.GMAIL_USER || process.env.FROM_EMAIL,
                to_email:     counterparty_email,
                subject:      draft.subject_line || our_position.subject,
                body:         '',              // no inbound body
                drafted_reply: draft.opening_email || '',
                status:       'pending_approval',  // user must approve before sending
                send_status:  'pending_approval',
                claude_analysis: {
                    opening_strategy:       draft.opening_strategy,
                    predicted_response_type: draft.predicted_response_type,
                    our_next_move_if:       draft.our_next_move_if,
                },
            })
            .select().single()

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                thread_id:  threadId,
                email_id:   savedEmail?.id,
                draft: {
                    subject:          draft.subject_line || our_position.subject,
                    body:             draft.opening_email || '',
                    opening_strategy: draft.opening_strategy,
                    predicted_response_type: draft.predicted_response_type,
                    our_next_move_if: draft.our_next_move_if,
                },
            }),
        }

    } catch (err) {
        console.error('[initiate-negotiation] error:', err)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        }
    }
}
