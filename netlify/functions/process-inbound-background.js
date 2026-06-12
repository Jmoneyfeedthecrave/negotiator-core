/**
 * Netlify Background Function: process-inbound-background
 * Invoked by email-inbound (thin receiver) with { thread_id, inbound_email_id, payload }.
 * The "-background" suffix gives this a 15-minute budget — Claude calls of any
 * size are now safe here.
 *
 * Carries the full analysis pipeline that used to live (and die) inside the
 * synchronous email-inbound function, plus fixes and the new escalation layer:
 *
 *  FIX-A  Text blocks extracted by type (content[0] can be a thinking block on
 *         Opus 4.7/4.8 — the old code silently got '' and fell back to garbage).
 *  FIX-B  Position-brief call moved to claude-sonnet-4-6 (fast, sufficient).
 *  NEW-1  Analysis schema gains `confidence` (0–1 on the drafted reply) and
 *         `requires_human` ({flag, reason} — e.g. counterparty introduced terms
 *         outside our brief).
 *  NEW-2  ESCALATION LAYER (autonomous mode): the agent auto-schedules only when
 *         confidence ≥ AUTO_SEND_CONFIDENCE_MIN (env, default 0.7) and
 *         requires_human is not flagged. Otherwise the draft holds for approval
 *         and the thread is marked needs_attention with a reason — this is what
 *         Mission Control's attention queue reads.
 *  NEW-3  Circuit-breaker blocks and processing errors also set needs_attention.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { NEGOTIATION_PLAYBOOK, TACTIC_DETECTION_GUIDE } from './negotiationPlaybook.js'

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8'   // safe at any latency now
const BRIEF_MODEL = 'claude-sonnet-4-6'                        // FIX-B: fast inference brief
const AUTO_SEND_CONFIDENCE_MIN = Number(process.env.AUTO_SEND_CONFIDENCE_MIN || 0.7)

const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://negotiator-core.netlify.app'

// FIX-A: never read content[0] — find the text block by type.
function textOf(claudeResponse) {
    return claudeResponse?.content?.find?.(b => b.type === 'text')?.text || ''
}

// Robust JSON extraction: fenced blocks, raw JSON, truncated/preamble-wrapped output.
function extractJSON(raw) {
    if (!raw) return null
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    const candidate = (fenced ? fenced[1] : raw).trim()
    try { return JSON.parse(candidate) } catch { /* fall through */ }
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
        try { return JSON.parse(candidate.slice(start, end + 1)) } catch { /* fall through */ }
    }
    return null
}

async function processAttachments(attachments) {
    const results = []
    for (const attachment of (attachments || [])) {
        const { Name = '', ContentType = '', Content = '' } = attachment
        if (!Content) continue
        const ext = Name.toLowerCase().split('.').pop()
        const isPdf = ext === 'pdf' || ContentType.includes('pdf')
        const isDocx = ext === 'docx' || ContentType.includes('wordprocessingml') || ContentType.includes('msword')
        const isTxt = ext === 'txt' || ContentType.startsWith('text/')
        try {
            if (isPdf) {
                results.push({ name: Name, type: 'pdf', base64: Content })
            } else if (isDocx) {
                const buf = Buffer.from(Content, 'base64')
                const result = await mammoth.extractRawText({ buffer: buf })
                results.push({ name: Name, type: 'text', text: result.value.trim() })
            } else if (isTxt) {
                const buf = Buffer.from(Content, 'base64')
                results.push({ name: Name, type: 'text', text: buf.toString('utf-8').trim() })
            }
        } catch (err) {
            console.error(`[attachment] ${Name}:`, err.message)
        }
    }
    return results
}

async function fetchLearnedPatterns() {
    try {
        const { data } = await supabase
            .from('learned_patterns')
            .select('source_type, domain, situation_type, tactic_used, what_worked, what_failed, lesson, outcome_type')
            .order('confidence_score', { ascending: false })
            .limit(30)
        return data || []
    } catch { return [] }
}

function computeScheduledSendTime(domain, receivedAt, theirResponseDeltaMs, urgencyScore, timezoneOffsetHours = -5) {
    const now = receivedAt ? new Date(receivedAt) : new Date()
    const domainMinHours = {
        'real estate': 4, 'realty': 4, 'mortgage': 4,
        'insurance': 4, 'carrier': 8, 'mga': 8, 'reinsurance': 24,
        'employment': 2, 'executive': 4,
        'saas': 2, 'software': 2, 'vendor': 2,
        'legal': 8, 'contract': 8,
        'finance': 4, 'investment': 8, 'merger': 24, 'acquisition': 24,
    }
    const domainKey = Object.keys(domainMinHours).find(k => domain.toLowerCase().includes(k)) || 'general'
    const minHours = domainMinHours[domainKey] || 2
    const urgencyMultiplier = urgencyScore > 0.7 ? 1.5 : 1.0
    const waitHours = Math.round(minHours * urgencyMultiplier)
    const theirWaitHours = theirResponseDeltaMs ? theirResponseDeltaMs / 3600000 : 0
    const finalWaitHours = Math.max(waitHours, theirWaitHours * 0.5)

    let sendAt = new Date(now.getTime() + finalWaitHours * 3600000)
    const businessStartUTC = 8 - timezoneOffsetHours
    const businessEndUTC = 17 - timezoneOffsetHours
    const hourUTC = sendAt.getUTCHours()
    if (hourUTC < businessStartUTC) {
        sendAt.setUTCHours(businessStartUTC + 2, 0, 0, 0)
    } else if (hourUTC >= businessEndUTC) {
        sendAt.setUTCDate(sendAt.getUTCDate() + 1)
        sendAt.setUTCHours(businessStartUTC + 2, 0, 0, 0)
    }
    while (sendAt.getUTCDay() === 0 || sendAt.getUTCDay() === 6) {
        sendAt.setUTCDate(sendAt.getUTCDate() + 1)
    }
    return { scheduledSendAt: sendAt.toISOString(), waitHours: Math.round(finalWaitHours) }
}

function buildEmailNegotiatorPrompt(threadHistory, inboundEmail, domain, textAttachments, learnedPatterns, counterpartyIntel, counterpartyProfile, threadState, emailMeta, ourPosition) {
    const metaBlock = emailMeta ? `
META-SIGNAL INTELLIGENCE:
  Response time delta: ${emailMeta.responseTimeDeltaHrs != null ? `${emailMeta.responseTimeDeltaHrs.toFixed(1)} hours since our last email` : 'First email in thread'}
  Email word count: ${emailMeta.wordCount} words (${emailMeta.wordCountTrend || 'baseline'})
  CC changes: ${emailMeta.ccChanges || 'none'}
  Pronoun pattern: ${emailMeta.pronounPattern || 'not yet established'}
  Day/time sent: ${emailMeta.dayTime || 'unknown'}
INTERPRET: Immediate replies = scripted. Very long delays = uncertain. Short dismissive email = power play. Long over-explained email = anxiety or bluff.
` : ''

    const intelBlock = counterpartyIntel && Object.keys(counterpartyIntel).length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COUNTERPARTY INTELLIGENCE BRIEF — READ BEFORE ANALYZING EMAIL
This is what we know about them BEFORE reading their message.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Company: ${counterpartyIntel.company_name || 'Unknown'} (${counterpartyIntel.domain || ''})
Company Overview: ${counterpartyIntel.company_summary || 'No data'}
Financial Health: ${counterpartyIntel.financial_health || 'Unknown'}
Recent News: ${counterpartyIntel.recent_news || 'None found'}
Sender: ${counterpartyIntel.person_name || 'Unknown'}
Person Background: ${counterpartyIntel.person_summary || 'None found'}
DETECTED LEVERAGE SIGNALS:
${counterpartyIntel.leverage_signals?.length ? counterpartyIntel.leverage_signals.map(s => `  ⚡ ${s}`).join('\n') : '  None detected'}
NEGOTIATING IMPLICATION: ${counterpartyIntel.negotiating_implications || 'Standard posture'}
` : ''

    const profileBlock = counterpartyProfile && Object.keys(counterpartyProfile).length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACCUMULATED COUNTERPARTY PROFILE — BUILT FROM ALL PRIOR EXCHANGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Communication style: ${counterpartyProfile.communication_style || 'Unknown'}
Decision authority: ${counterpartyProfile.decision_authority || 'Unknown'}
Personality type: ${counterpartyProfile.personality_type || 'Unknown'}
Ego sensitivity: ${counterpartyProfile.ego_sensitivity || 'Unknown'}
Emotional baseline: ${counterpartyProfile.emotional_baseline || 'Unknown'}
Trust level: ${counterpartyProfile.trust_level != null ? `${(counterpartyProfile.trust_level * 100).toFixed(0)}%` : 'Unknown'}
Detected pressure points: ${counterpartyProfile.detected_pressure_points?.join(', ') || 'None yet'}
Red lines detected: ${counterpartyProfile.red_lines_detected?.join(', ') || 'None yet'}
Bluff signals seen: ${counterpartyProfile.bluff_signals_seen?.join(', ') || 'None yet'}
Their tells: ${counterpartyProfile.tells?.join(', ') || 'None yet'}
` : ''

    const stateBlock = threadState && Object.keys(threadState).length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTIVE STRATEGIC STATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Move number: ${threadState.move_number || 1}
Escalation level: ${threadState.escalation_level || 1}/5 (1=collaborative, 3=assertive, 5=take-away/final)
Strategic game plan: ${threadState.strategic_game_plan || 'Not yet established — first email'}
Planned next move: ${threadState.planned_next_move || 'Gather intelligence'}
Concessions WE have made: ${threadState.concessions_we_made?.join('; ') || 'None'}
Concessions THEY have made: ${threadState.concessions_they_made?.join('; ') || 'None'}
Dimensions we have NOT moved on: ${threadState.no_move_dimensions?.join(', ') || 'None'}
Thread observations: ${threadState.thread_observations?.slice(-5).join(' | ') || 'None yet'}
` : ''

    const ourPositionBlock = ourPosition ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUR NEGOTIATION POSITION — THIS IS WHAT WE WANT TO ACHIEVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Negotiation type: ${ourPosition.negotiation_type || 'General'}
Primary goal: ${ourPosition.goal}
Ideal outcome: ${ourPosition.ideal_outcome || 'Not specified'}
Walk-away minimum: ${ourPosition.walkaway || 'Not specified'}
Our BATNA: ${ourPosition.batna || 'Not specified'}
Concessions we can offer: ${ourPosition.concessions_available || 'None identified'}
Hard constraints: ${ourPosition.constraints || 'None specified'}
Recommended tone: ${ourPosition.tone || 'collaborative'}
CRITICAL: Your draft reply MUST serve this position. DO NOT offer terms below the walk-away minimum. DO NOT reveal our BATNA.
` : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUR POSITION: NOT YET SET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No position has been confirmed for this thread yet. Draft a neutral, information-gathering reply that keeps all options open. Do NOT make any offers, commitments, or concessions.
`

    const historyBlock = threadHistory.length > 0
        ? threadHistory.map((e, i) =>
            `[${i + 1}] ${e.direction === 'inbound' ? 'THEM' : 'US'}: ${e.body}`
        ).join('\n\n')
        : 'This is the first message in the thread.'

    const textContractBlock = textAttachments?.length > 0
        ? `\nATTACHED DOCUMENTS (extracted text):\n${textAttachments.map(c =>
            `--- ${c.name} ---\n${c.text}`
        ).join('\n\n')}`
        : ''

    const hasContract = textAttachments?.length > 0

    let patternsBlock = ''
    if (learnedPatterns && learnedPatterns.length > 0) {
        const own = learnedPatterns.filter(p => p.source_type === 'own_negotiation')
        const historical = learnedPatterns.filter(p => p.source_type === 'historical')
        const research = learnedPatterns.filter(p => p.source_type === 'research')
        const fmt = (p) => `  SITUATION: ${p.situation_type}\n  TACTIC: ${p.tactic_used}\n  LESSON: ${p.lesson}${p.what_worked ? `\n  WORKED: ${p.what_worked}` : ''}${p.what_failed ? `\n  FAILED: ${p.what_failed}` : ''}`
        const sections = []
        if (own.length) sections.push(`🏆 FROM OUR OWN NEGOTIATIONS (highest priority):\n${own.map(fmt).join('\n\n')}`)
        if (historical.length) sections.push(`📖 HISTORICAL PRECEDENTS:\n${historical.map(fmt).join('\n\n')}`)
        if (research.length) sections.push(`🔬 RESEARCH FINDINGS:\n${research.map(fmt).join('\n\n')}`)
        if (sections.length) {
            patternsBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LEARNED EXPERIENCE — APPLY THESE BEFORE ANY OTHER FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${sections.join('\n\n')}
`
        }
    }

    return `${ourPositionBlock}${intelBlock}${profileBlock}${stateBlock}${patternsBlock}${NEGOTIATION_PLAYBOOK}

${TACTIC_DETECTION_GUIDE}

${metaBlock}
You are now operating as an ELITE AI NEGOTIATOR in a live ${domain} negotiation.
Your mission: WIN the best possible outcome using every tool in the playbook above.
${textContractBlock}

NEGOTIATION THREAD HISTORY:
${historyBlock}

LATEST INCOMING MESSAGE FROM COUNTERPARTY:
${inboundEmail}

MANDATORY ANALYSIS PROTOCOL — Follow in EXACT order:

STEP 0 — PSYCHOLOGICAL PROFILE READ (Human Behavior Mastery):
  A. COGNITIVE BIASES ACTIVE: What biases are driving their decisions right now?
     (Loss aversion? Sunk cost? Status quo bias? Anchoring? Reactive devaluation?)
  B. PERSONALITY TYPE: What DISC type signals are present? Any dark triad indicators?
     (Analytical/Driver/Expressive/Amiable — or Narcissist/Machiavellian?)
  C. STATUS NEED: What do they need to feel in this interaction?
     (Dominant? Smart? Respected? The person who got a deal? The person who won?)
  D. DECEPTION SIGNALS: Over-justification? Pronoun shifts? Hedging on hard limits? Topic abandonment?
  E. TARGET EMOTIONAL STATE: What state are they in NOW vs. what state do we need them in BEFORE they read our reply?

STEP 1 — TACTIC IDENTIFICATION:
  Map their message to the tactic detection matrix. What specific moves did they just use?
  Also read the META-SIGNALS above — response time, length, CC patterns.

STEP 2 — INTELLIGENCE ASSESSMENT:
  What does this message reveal about their BATNA, real interests, pressures, and deadlines?
  What are they NOT saying? What topic did they avoid or abandon? That is your leverage point.
  CHESS LENS: Are they reacting to our frame (we have tempo) or are we reacting to theirs?
  Is there a zugzwang opportunity — a response where any move they make concedes something?

STEP 2.5 — OPPORTUNITY IDENTIFICATION:
  A. ACCUSATION AUDIT: What objections will they have to our next ask? Pre-empt them in the reply.
  B. LOSS FRAME: How do we frame our proposal as what they LOSE by declining, not just what they gain?
  C. PIE EXPANSION: Is there anything we can offer that costs us little but is worth a lot to them?
  D. MINIMUM VIABLE YES: If they won't move on the main ask, what is the smallest yes to maintain momentum?
  E. POSITION vs. MATERIAL: Are we being asked to trade a structural right (position) for immediate cash (material)? If so, resist.

STEP 3 — STRATEGIC PLAN:
  What is our move in the sequence? Are we executing the plan or does new intel require adaptation?
  Should we escalate pressure (increase escalation level) or hold and gather more intelligence?
  How does the counterparty profile inform which framework to deploy?
  ENDGAME CHECK: Does this move build toward the closing position we defined at the start?

STEP 3.5 — HUMAN ESCALATION CHECK:
  Does this email introduce material terms OUTSIDE our stated position (new dimensions like
  lock-in periods, exclusivity, legal liability, scope changes)? Does it require a judgment
  call our position brief doesn't cover? If yes, set requires_human.flag = true with the reason.
  Also rate your confidence (0-1) that your drafted reply is the right move given everything above.

STEP 4 — DRAFT THE REPLY:
  Write the exact email. Professional, strategic, confident, never desperate.
  Every word serves a tactical purpose. The tone should be calmer and more certain than their tone.
  ${hasContract ? 'Reference specific contract clauses where relevant. Flag problematic language.' : ''}

Respond ONLY with valid JSON:
{
  "psychological_read": {
    "active_biases": ["specific bias and how it is showing"],
    "personality_type": "DISC type + any dark triad signals",
    "status_need": "what they need to feel in this interaction",
    "deception_signals": ["specific tells observed"],
    "target_emotional_state": "state to put them in before reading our reply"
  },
  "meta_signals": {
    "response_time_read": "interpretation of their response timing",
    "length_pattern": "what email length pattern signals",
    "other_signals": "pronoun shifts, CC changes, topic abandonment"
  },
  "technique_detected": "Specific tactic(s) they used — cite the framework",
  "technique_detected_reasoning": "Exactly which signals gave it away",
  "technique_applied": "Specific counter-tactic we are deploying — cite the framework",
  "move": "One-line strategic move label",
  "bluff_probability": 0.0,
  "bluff_reasoning": "Specific signals this is a bluff vs. genuine constraint",
  "internal_reasoning": "Full private strategic analysis",
  "leverage_assessment": "Their BATNA vs ours — who has more power and why",
  "chess_position": "Do we have tempo? Is there a zugzwang? Position vs. material trade-off?",
  "next_move_prediction": "What they will likely say/do next and how we should respond",
  "confidence": 0.0,
  "requires_human": { "flag": false, "reason": "only set when human judgment is genuinely needed" },
  "counterparty_profile_update": {
    "communication_style": "aggressive|collaborative|passive|analytical",
    "decision_authority": "confirmed_decision_maker|gatekeeper|unknown",
    "personality_type": "DISC + dark triad assessment",
    "ego_sensitivity": "high|medium|low",
    "emotional_baseline": "calm|anxious|frustrated|overconfident",
    "trust_level": 0.0,
    "detected_pressure_points": ["new pressure points observed this email"],
    "red_lines_detected": ["new red lines observed"],
    "bluff_signals_seen": ["new bluff signals observed"],
    "tells": ["behavioral patterns now confirmed"]
  },
  "thread_state_update": {
    "move_number": 1,
    "escalation_level": 1,
    "strategic_game_plan": "Updated plan for next 3 moves",
    "planned_next_move": "Specific next action after this reply",
    "concessions_we_made": ["any concession made in this reply"],
    "concessions_they_made": ["any concession they made in this email"],
    "no_move_dimensions": ["dimensions neither side has moved on"],
    "thread_observations": ["one-line observation from this exchange"]
  },
  "recommended_send_time": "ISO timestamp — when to send for maximum strategic effect",
  "timing_reasoning": "Why this send time — domain norms, their urgency, cadence matching",
  ${hasContract ? '"contract_analysis": [{"clause": "exact clause text", "risk": "high|medium|low", "issue": "why problematic", "redline": "suggested replacement"}],' : ''}
  "drafted_reply": "The exact, polished email text to send"
}`
}

async function flagThread(threadId, reason) {
    await supabase.from('email_threads')
        .update({ needs_attention: true, attention_reason: reason, updated_at: new Date().toISOString() })
        .eq('id', threadId)
}

export const handler = async (event) => {
    // Netlify has already ACKed 202 to the receiver by the time this runs.
    let job
    try { job = JSON.parse(event.body) } catch {
        console.error('[process-inbound] invalid job body')
        return
    }

    const { thread_id: threadId, inbound_email_id: inboundEmailId, payload = {} } = job
    if (!threadId) { console.error('[process-inbound] thread_id required'); return }

    const {
        Subject: subject = payload.subject || '(no subject)',
        TextBody: body = '',
        HtmlBody: htmlBody = '',
        MessageID: messageId = '',
        Attachments: attachments = [],
        domain = 'Email Negotiation',
        mode = 'coached',
    } = payload

    const counterpartyEmail = payload.From || payload.from_email || ''
    const emailBody = body || payload.body || ''
    const emailBodyClean = emailBody || htmlBody.replace(/<[^>]+>/g, '') || ''

    try {
        // ── Load thread intelligence ─────────────────────────────────────────────
        const { data: threadRecord } = await supabase
            .from('email_threads')
            .select('mode, domain, counterparty_intel, counterparty_profile, thread_state, our_position, position_confirmed')
            .eq('id', threadId)
            .maybeSingle()
        const threadMode = threadRecord?.mode || mode
        const threadDomain = threadRecord?.domain || domain
        const counterpartyIntel = threadRecord?.counterparty_intel || {}
        const counterpartyProfile = threadRecord?.counterparty_profile || {}
        const threadState = threadRecord?.thread_state || {}
        const isFirstEmail = Object.keys(counterpartyIntel).length === 0
        let ourPosition = threadRecord?.our_position || null

        const [{ data: threadEmails }, learnedPatterns] = await Promise.all([
            supabase.from('emails')
                .select('id, direction, body, claude_analysis, created_at')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true }),
            fetchLearnedPatterns(),
        ])

        // Counterparty research on first contact (fire-and-forget)
        if (isFirstEmail && counterpartyEmail) {
            fetch(`${SITE_URL}/.netlify/functions/research-counterparty`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: threadId, from_email: counterpartyEmail, from_name: '' }),
            }).catch(err => console.error('[research-counterparty] fire-and-forget failed:', err.message))
        }

        // ── Position brief (first email without a position) — FIX-B: sonnet ─────
        if (!ourPosition) {
            try {
                const briefPrompt = `You are an expert negotiator reading an inbound email to figure out what the RECIPIENT (our client, not the sender) probably wants to achieve.

EMAIL SUBJECT: ${subject || '(no subject)'}
EMAIL BODY:
${(emailBody || htmlBody?.replace(/<[^>]+>/g, '') || '').slice(0, 2000)}

Based on this email, infer:
1. What kind of negotiation is this? (e.g. salary, real estate sale, contract terms, vendor pricing, lease, settlement, etc.)
2. What does the COUNTERPARTY (the sender) appear to want?
3. What would a REASONABLE goal be for the RECIPIENT (our client)?
4. Suggest a realistic ideal outcome, walk-away point, and any obvious constraints.

Be specific — use numbers and dates if you can infer them. If the email is vague, make reasonable assumptions.

Return ONLY valid JSON:
{
  "negotiation_type": "one phrase, e.g. 'Real estate purchase' or 'Software contract renewal'",
  "counterparty_wants": "what the sender appears to want",
  "goal": "our recommended primary goal",
  "ideal_outcome": "best realistic outcome we could achieve",
  "walkaway": "suggested walk-away / minimum acceptable",
  "batna": "likely BATNA if this deal falls through",
  "concessions_available": "concessions we might offer to move things forward",
  "constraints": "any obvious constraints on our side",
  "tone": "recommended tone — collaborative | assertive | exploratory | firm"
}`
                const briefRes = await anthropic.messages.create({
                    model: BRIEF_MODEL,
                    max_tokens: 1200,
                    messages: [{ role: 'user', content: briefPrompt }],
                })
                ourPosition = extractJSON(textOf(briefRes))
                if (ourPosition) {
                    await supabase.from('email_threads')
                        .update({ our_position: ourPosition, position_confirmed: false })
                        .eq('id', threadId)
                }
            } catch (briefErr) {
                console.error('[brief-draft] failed:', briefErr.message)
            }
        }

        // ── Meta-signals ─────────────────────────────────────────────────────────
        const lastOutbound = (threadEmails || []).filter(e => e.direction === 'outbound').pop()
        const responseTimeDeltaMs = lastOutbound?.created_at
            ? Date.now() - new Date(lastOutbound.created_at).getTime()
            : null
        const wordCount = emailBodyClean.split(/\s+/).filter(Boolean).length
        const prevWordCounts = (threadEmails || []).filter(e => e.direction === 'inbound').map(e => e.body?.split(/\s+/).length || 0)
        const avgPrev = prevWordCounts.length ? prevWordCounts.reduce((a, b) => a + b, 0) / prevWordCounts.length : 0
        const wordCountTrend = avgPrev === 0 ? 'baseline' : wordCount > avgPrev * 1.4 ? 'longer than usual (anxiety/over-justification?)' : wordCount < avgPrev * 0.6 ? 'shorter than usual (power play?)' : 'normal'
        const iWeCount = (emailBodyClean.match(/\bI\b/g) || []).length
        const weCount = (emailBodyClean.match(/\bwe\b/gi) || []).length
        const pronounPattern = iWeCount > weCount * 2 ? 'Heavy I — speaking personally, not for group' : weCount > iWeCount * 2 ? 'Heavy we — speaking for group or hiding behind it' : 'Mixed — standard'
        const sentDay = new Date().toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
        const emailMeta = {
            responseTimeDeltaHrs: responseTimeDeltaMs != null ? responseTimeDeltaMs / 3600000 : null,
            wordCount,
            wordCountTrend,
            pronounPattern,
            dayTime: sentDay,
            ccChanges: 'not tracked via inbound payload',
        }

        // ── Attachments ──────────────────────────────────────────────────────────
        const allAttachments = await processAttachments(attachments)
        const pdfAttachments = allAttachments.filter(a => a.type === 'pdf')
        const textAttachments = allAttachments.filter(a => a.type === 'text')
        const hasAttachments = allAttachments.length > 0

        // ── Main analysis (Opus-class, safe in background) ───────────────────────
        const historyForPrompt = (threadEmails || [])
            .filter(e => e.id !== inboundEmailId)
            .slice(-8)
        const prompt = buildEmailNegotiatorPrompt(
            historyForPrompt, emailBodyClean, threadDomain, textAttachments, learnedPatterns,
            counterpartyIntel, counterpartyProfile, threadState, emailMeta, ourPosition
        )
        const userContent = [
            ...pdfAttachments.map(pdf => ({
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 },
                title: pdf.name,
                cache_control: { type: 'ephemeral' },
            })),
            { type: 'text', text: prompt },
        ]

        const claudeRes = await anthropic.messages.create({
            model: MODEL,
            max_tokens: hasAttachments ? 10000 : 8000,
            messages: [{ role: 'user', content: userContent }],
        })

        const rawClaude = textOf(claudeRes)   // FIX-A
        let analysis = extractJSON(rawClaude)
        if (!analysis) {
            console.error('[process-inbound] analysis JSON parse failed — using raw text as reply')
            analysis = { drafted_reply: rawClaude, technique_detected: 'unknown', confidence: 0.3 }
        }

        // ── Scheduling ───────────────────────────────────────────────────────────
        const actualUrgencyScore = analysis.bluff_probability != null ? 1 - analysis.bluff_probability : 0.5
        const { scheduledSendAt: finalScheduledSendAt } = computeScheduledSendTime(
            threadDomain, new Date().toISOString(), responseTimeDeltaMs, actualUrgencyScore
        )

        // ── Persist analysis on the inbound row ─────────────────────────────────
        if (inboundEmailId) {
            await supabase.from('emails')
                .update({ claude_analysis: analysis, status: 'received' })
                .eq('id', inboundEmailId)
        }

        // ── ESCALATION DECISION (NEW-2) ──────────────────────────────────────────
        const confidence = typeof analysis.confidence === 'number' ? analysis.confidence : 0.5
        const humanFlag = analysis.requires_human?.flag === true
        let escalationReason = null
        if (humanFlag) escalationReason = `agent_flagged: ${analysis.requires_human?.reason || 'human judgment required'}`
        else if (threadMode === 'autonomous' && confidence < AUTO_SEND_CONFIDENCE_MIN) {
            escalationReason = `low_confidence (${confidence.toFixed(2)} < ${AUTO_SEND_CONFIDENCE_MIN})`
        }

        const autoSend = threadMode === 'autonomous' && !escalationReason

        // ── Outbound draft row ───────────────────────────────────────────────────
        const ourEmail = process.env.GMAIL_USER || process.env.FROM_EMAIL
        const { data: replyEmail } = await supabase
            .from('emails')
            .insert({
                thread_id: threadId,
                direction: 'outbound',
                from_email: ourEmail,
                to_email: counterpartyEmail,
                subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
                body: '',
                drafted_reply: analysis.drafted_reply || '',
                status: 'pending_approval',
                scheduled_send_at: finalScheduledSendAt,
                send_status: autoSend ? 'scheduled' : 'pending_approval',
                ...(messageId && { in_reply_to: messageId }),
            })
            .select().maybeSingle()

        // ── Profile + state merge ────────────────────────────────────────────────
        const profileUpdate = analysis.counterparty_profile_update
        const stateUpdate = analysis.thread_state_update
        const threadUpdates = { updated_at: new Date().toISOString() }
        if (profileUpdate) {
            const merged = { ...counterpartyProfile, ...profileUpdate }
            if (profileUpdate.detected_pressure_points)
                merged.detected_pressure_points = [...new Set([...(counterpartyProfile.detected_pressure_points || []), ...profileUpdate.detected_pressure_points])]
            if (profileUpdate.red_lines_detected)
                merged.red_lines_detected = [...new Set([...(counterpartyProfile.red_lines_detected || []), ...profileUpdate.red_lines_detected])]
            if (profileUpdate.bluff_signals_seen)
                merged.bluff_signals_seen = [...new Set([...(counterpartyProfile.bluff_signals_seen || []), ...profileUpdate.bluff_signals_seen])]
            if (profileUpdate.tells)
                merged.tells = [...new Set([...(counterpartyProfile.tells || []), ...profileUpdate.tells])]
            threadUpdates.counterparty_profile = merged
        }
        if (stateUpdate) {
            const mergedState = { ...threadState, ...stateUpdate }
            if (stateUpdate.thread_observations) {
                const existing = threadState.thread_observations || []
                mergedState.thread_observations = [...existing, ...stateUpdate.thread_observations].slice(-20)
            }
            if (stateUpdate.concessions_we_made)
                mergedState.concessions_we_made = [...(threadState.concessions_we_made || []), ...stateUpdate.concessions_we_made]
            if (stateUpdate.concessions_they_made)
                mergedState.concessions_they_made = [...(threadState.concessions_they_made || []), ...stateUpdate.concessions_they_made]
            threadUpdates.thread_state = mergedState
        }
        await supabase.from('email_threads').update(threadUpdates).eq('id', threadId)

        // ── Circuit breakers (autonomous only) ───────────────────────────────────
        if (autoSend && analysis.drafted_reply) {
            let blocked = false
            let blockReason = ''

            const recentInbound = (threadEmails || [])
                .filter(e => e.direction === 'inbound' && e.id !== inboundEmailId)
                .slice(-5)
            if (recentInbound.some(e => e.body?.trim().toLowerCase() === emailBodyClean.trim().toLowerCase())) {
                blocked = true; blockReason = 'duplicate_message'
            }

            if (!blocked) {
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
                const { count: recentSentCount } = await supabase
                    .from('emails')
                    .select('id', { count: 'exact', head: true })
                    .eq('thread_id', threadId)
                    .eq('direction', 'outbound')
                    .gte('created_at', oneDayAgo)
                if ((recentSentCount || 0) >= 8) { blocked = true; blockReason = 'velocity_limit' }
            }

            if (!blocked) {
                const lastThreeInbound = (threadEmails || [])
                    .filter(e => e.direction === 'inbound' && e.id !== inboundEmailId)
                    .slice(-3)
                if (lastThreeInbound.length === 3) {
                    const bodies = lastThreeInbound.map(e => e.body?.trim().toLowerCase())
                    if (bodies.every(b => b === bodies[0])) { blocked = true; blockReason = 'stall_detected' }
                }
            }

            if (blocked) {
                console.warn(`[autonomous-blocked] thread=${threadId} reason=${blockReason}`)
                await supabase.from('email_threads')
                    .update({ mode: 'coached', updated_at: new Date().toISOString() })
                    .eq('id', threadId)
                await flagThread(threadId, `circuit_breaker: ${blockReason}`)   // NEW-3
                if (replyEmail?.id) {
                    await supabase.from('emails')
                        .update({ send_status: `paused:${blockReason}`, status: `paused:${blockReason}` })
                        .eq('id', replyEmail.id)
                }
            } else {
                console.log(`[autonomous] thread=${threadId} reply=${replyEmail?.id} conf=${confidence} scheduled for ${finalScheduledSendAt}`)
            }
        } else if (escalationReason) {
            // Held for human — surface in the attention queue
            await flagThread(threadId, escalationReason)
            console.log(`[escalated] thread=${threadId} reason=${escalationReason}`)
        } else if (threadMode === 'coached') {
            // Coached drafts always need the human — that's the queue's normal work
            await flagThread(threadId, 'draft_ready')
        }
    } catch (err) {
        console.error('[process-inbound]', err)
        if (inboundEmailId) {
            await supabase.from('emails').update({ status: 'analysis_failed' }).eq('id', inboundEmailId)
        }
        await flagThread(threadId, `processing_error: ${err.message}`.slice(0, 200))
    }
}
