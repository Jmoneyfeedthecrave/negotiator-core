/**
 * Netlify Function: email-inbound
 * POST /api/email-inbound
 * Receives inbound email from Postmark webhook.
 * Parses PDF/DOCX attachments, runs Claude negotiation engine, saves draft.
 */

// createClient import removed - use getDB() from fnUtils.js instead
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { NEGOTIATION_PLAYBOOK, TACTIC_DETECTION_GUIDE } from './negotiationPlaybook.js'
import { getSupabaseAdmin, MODEL_HAIKU, handleOptions } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

// Process attachments � PDFs returned as base64 for Claude's native document API
// DOCX/TXT extracted as plain text
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
                // Pass raw base64 directly to Claude � it reads PDFs natively
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

// Fetch top learned patterns across ALL domains � Claude decides relevance, not a keyword filter
async function fetchLearnedPatterns() {
    try {
        const { data } = await getDB()
            .from('learned_patterns')
            .select('id, source_type, domain, situation_type, tactic_used, what_worked, what_failed, lesson, outcome_type, confidence_score')
            .order('confidence_score', { ascending: false })
            .limit(30)
        return data || []
    } catch { return [] }
}

function computeScheduledSendTime(domain, receivedAt, theirResponseDeltaMs, urgencyScore) {
    const now = receivedAt ? new Date(receivedAt) : new Date()
    // Domain-specific minimum wait (ms)
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

    // If they were pushy (high urgency), wait longer
    const urgencyMultiplier = urgencyScore > 0.7 ? 1.5 : 1.0
    const waitHours = Math.round(minHours * urgencyMultiplier)

    // Also match their cadence: don't reply in 2h if they took 2 days
    const theirWaitHours = theirResponseDeltaMs ? theirResponseDeltaMs / 3600000 : 0
    const finalWaitHours = Math.max(waitHours, theirWaitHours * 0.5)

    // Compute send time and push into business hours (8am-5pm)
    let sendAt = new Date(now.getTime() + finalWaitHours * 3600000)
    const hour = sendAt.getHours()
    if (hour < 8) sendAt.setHours(10, 0, 0, 0)
    else if (hour >= 17) { sendAt.setDate(sendAt.getDate() + 1); sendAt.setHours(10, 0, 0, 0) }
    // Skip weekends
    while (sendAt.getDay() === 0 || sendAt.getDay() === 6) { sendAt.setDate(sendAt.getDate() + 1) }
    return { scheduledSendAt: sendAt.toISOString(), waitHours: Math.round(finalWaitHours) }
}

function buildEmailNegotiatorPrompt(threadHistory, inboundEmail, domain, textAttachments, learnedPatterns, counterpartyIntel, counterpartyProfile, threadState, emailMeta) {
    // -- Meta-signals block (Gap 7) -----------------------------------------
    const metaBlock = emailMeta ? `
META-SIGNAL INTELLIGENCE:
  Response time delta: ${emailMeta.responseTimeDeltaHrs != null ? `${emailMeta.responseTimeDeltaHrs.toFixed(1)} hours since our last email` : 'First email in thread'}
  Email word count: ${emailMeta.wordCount} words (${emailMeta.wordCountTrend || 'baseline'})
  CC changes: ${emailMeta.ccChanges || 'none'}
  Pronoun pattern: ${emailMeta.pronounPattern || 'not yet established'}
  Day/time sent: ${emailMeta.dayTime || 'unknown'}
INTERPRET: Immediate replies = scripted. Very long delays = uncertain. Short dismissive email = power play. Long over-explained email = anxiety or bluff.
` : ''

    // -- Counterparty intel block (Gap 9) -----------------------------------
    const intelBlock = counterpartyIntel && Object.keys(counterpartyIntel).length > 0 ? `
?????????????????????????????????????????????????????????
COUNTERPARTY INTELLIGENCE BRIEF � READ BEFORE ANALYZING EMAIL
This is what we know about them BEFORE reading their message.
?????????????????????????????????????????????????????????
Company: ${counterpartyIntel.company_name || 'Unknown'} (${counterpartyIntel.domain || ''})
Company Overview: ${counterpartyIntel.company_summary || 'No data'}
Financial Health: ${counterpartyIntel.financial_health || 'Unknown'}
Recent News: ${counterpartyIntel.recent_news || 'None found'}
Sender: ${counterpartyIntel.person_name || 'Unknown'}
Person Background: ${counterpartyIntel.person_summary || 'None found'}
DETECTED LEVERAGE SIGNALS:
${counterpartyIntel.leverage_signals?.length ? counterpartyIntel.leverage_signals.map(s => `  ? ${s}`).join('\n') : '  None detected'}
NEGOTIATING IMPLICATION: ${counterpartyIntel.negotiating_implications || 'Standard posture'}
` : ''

    // -- Counterparty profile block (Gap 4) ---------------------------------
    const profileBlock = counterpartyProfile && Object.keys(counterpartyProfile).length > 0 ? `
?????????????????????????????????????????????????????????
ACCUMULATED COUNTERPARTY PROFILE � BUILT FROM ALL PRIOR EXCHANGES
?????????????????????????????????????????????????????????
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

    // -- Thread state block (strategic game plan, concessions, escalation) -
    const stateBlock = threadState && Object.keys(threadState).length > 0 ? `
?????????????????????????????????????????????????????????
ACTIVE STRATEGIC STATE
?????????????????????????????????????????????????????????
Move number: ${threadState.move_number || 1}
Escalation level: ${threadState.escalation_level || 1}/5 (1=collaborative, 3=assertive, 5=take-away/final)
Strategic game plan: ${threadState.strategic_game_plan || 'Not yet established � first email'}
Planned next move: ${threadState.planned_next_move || 'Gather intelligence'}
Concessions WE have made: ${threadState.concessions_we_made?.join('; ') || 'None'}
Concessions THEY have made: ${threadState.concessions_they_made?.join('; ') || 'None'}
Dimensions we have NOT moved on: ${threadState.no_move_dimensions?.join(', ') || 'None'}
Thread observations: ${threadState.thread_observations?.slice(-5).join(' | ') || 'None yet'}
` : ''

    // -- Thread history block -----------------------------------------------
    const historyBlock = threadHistory.length > 0
        ? threadHistory.slice(-10).map((e, i) =>
            `[${i + 1}] ${e.direction === 'inbound' ? 'THEM' : 'US'}: ${(e.body || '').slice(0, 1000)}${(e.body || '').length > 1000 ? '...[truncated]' : ''}`
        ).join('\n\n')
        : 'This is the first message in the thread.'

    const textContractBlock = textAttachments?.length > 0
        ? `\nATTACHED DOCUMENTS (extracted text):\n${textAttachments.map(c =>
            `--- ${c.name} ---\n${c.text}`
        ).join('\n\n')}`
        : ''

    const hasContract = textAttachments?.length > 0

    // -- Learned patterns block ---------------------------------------------
    let patternsBlock = ''
    if (learnedPatterns && learnedPatterns.length > 0) {
        const own = learnedPatterns.filter(p => p.source_type === 'own_negotiation')
        const historical = learnedPatterns.filter(p => p.source_type === 'historical')
        const research = learnedPatterns.filter(p => p.source_type === 'research')
        const fmt = (p) => `  SITUATION: ${p.situation_type}\n  TACTIC: ${p.tactic_used}\n  LESSON: ${p.lesson}${p.what_worked ? `\n  WORKED: ${p.what_worked}` : ''}${p.what_failed ? `\n  FAILED: ${p.what_failed}` : ''}`
        const sections = []
        if (own.length) sections.push(`FROM OUR OWN NEGOTIATIONS (highest priority):\n${own.map(fmt).join('\n\n')}`)
        if (historical.length) sections.push(`HISTORICAL PRECEDENTS:\n${historical.map(fmt).join('\n\n')}`)
        if (research.length) sections.push(`RESEARCH FINDINGS:\n${research.map(fmt).join('\n\n')}`)
        if (sections.length) {
            patternsBlock = `
?????????????????????????????????????????????????????????
LEARNED EXPERIENCE � APPLY THESE BEFORE ANY OTHER FRAMEWORK
?????????????????????????????????????????????????????????
${sections.join('\n\n')}
`
        }
    }

    return `${intelBlock}${profileBlock}${stateBlock}${patternsBlock}${NEGOTIATION_PLAYBOOK}

${TACTIC_DETECTION_GUIDE}

${metaBlock}
You are operating as a professional strategic negotiation advisor in a live ${domain} negotiation.
Your role: analyze the incoming message and draft the most effective professional response.
${textContractBlock}

NEGOTIATION THREAD HISTORY:
${historyBlock}

LATEST MESSAGE FROM COUNTERPARTY:
${inboundEmail}

ANALYSIS PROTOCOL � Complete in order:

STEP 0 � BEHAVIORAL ASSESSMENT (Interest-Based Analysis):
  A. COGNITIVE PATTERNS: What decision-making patterns are influencing their position?
     (loss aversion, anchoring effects, status quo bias, commitment consistency?)
  B. COMMUNICATION STYLE: What DISC profile signals are present?
     (Analytical/Driver/Expressive/Amiable � this determines how to frame our response)
  C. RECOGNITION NEEDS: What outcome do they need to feel good about this deal?
     (Being seen as skilled? Getting a fair deal? Maintaining relationships? Speed?)
  D. CONSISTENCY SIGNALS: Are there any inconsistencies between their stated position and their behavior?
     (Over-justification, topic deflection, hedging on constraints they previously stated as firm?)
  E. TARGET FRAMING: What framing will make our response most compelling to this person specifically?

STEP 1 � TACTIC IDENTIFICATION:
  Map their message to the tactic detection matrix. What specific negotiation moves did they use?
  Also interpret the META-SIGNALS above � response time, length patterns, phrasing choices.

STEP 2 � INTEREST ASSESSMENT:
  What does this message reveal about their underlying interests, constraints, and timeline pressures?
  What topics did they NOT address? What they avoid often signals where they're most flexible.
  STRATEGIC LENS: Are we controlling the frame of this negotiation, or are they? What move maintains our position?

STEP 2.5 � OPPORTUNITY IDENTIFICATION:
  A. OBJECTION PREVIEW: What concerns will they raise about our next ask? Address them proactively.
  B. REFRAMING OPPORTUNITY: How do we present our position in terms of their interests, not ours?
  C. VALUE CREATION: Is there anything we can offer that costs us little but is worth a lot to them?
  D. MINIMUM VIABLE YES: If they won''t move on the main ask, what is the smallest yes that keeps progress?
  E. POSITION vs. INTEREST: Are we being asked to trade a structural principle for immediate gain? If so, assess carefully.

STEP 3 � STRATEGIC PLAN:
  What is our optimal response in this sequence? Does new information require adjusting our approach?
  Should we ask clarifying questions (gather more information) or make a specific proposal?
  How does their communication profile inform which approach to use in our response?

STEP 4 � DRAFT THE REPLY:
  Write the professional response. Confident, clear, and appropriately direct for this domain.
  The tone should project calm certainty regardless of any pressure in their message.
  ${hasContract ? 'Reference specific contract clauses where relevant. Flag any terms that warrant clarification.' : ''}

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
  "technique_detected": "Specific tactic(s) they used � cite the framework",
  "technique_detected_reasoning": "Exactly which signals gave it away",
  "technique_applied": "Specific counter-tactic we are deploying � cite the framework",
  "move": "One-line strategic move label",
  "bluff_probability": 0.0,
  "bluff_reasoning": "Specific signals this is a bluff vs. genuine constraint",
  "internal_reasoning": "Full private strategic analysis",
  "leverage_assessment": "Their BATNA vs ours � who has more power and why",
  "chess_position": "Do we have tempo? Is there a zugzwang? Position vs. material trade-off?",
  "next_move_prediction": "What they will likely say/do next and how we should respond",
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
  "recommended_send_time": "ISO timestamp � when to send for maximum strategic effect",
  "timing_reasoning": "Why this send time � domain norms, their urgency, cadence matching",
  "patterns_used": ["ID or name of each learned pattern you actually applied in this response � reference the LEARNED EXPERIENCE block above"],
  "novel_tactic": "If you used a tactic NOT from any learned pattern, describe it here in one line. null if all tactics came from known patterns.",
  ${hasContract ? '"contract_analysis": [{"clause": "exact clause text", "risk": "high|medium|low", "issue": "why problematic", "redline": "suggested replacement"}],' : ''}
  "drafted_reply": "The exact, polished email text to send"
}`
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }


    let payload
    try { payload = JSON.parse(event.body) } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    const {
        From: fromEmail = '',
        To: toEmail = '',
        Subject: subject = '(no subject)',
        TextBody: body = '',
        HtmlBody: htmlBody = '',
        MessageID: messageId = '',
        InReplyTo: inReplyTo = '',
        Headers: headers = [],
        // Also support manual submissions from the UI
        thread_id: existingThreadId = null,
        domain = 'Email Negotiation',
        mode = 'coached',
        Attachments: attachments = [],
    } = payload

    // Also check References header from Postmark's Headers array
    const referencesHeader = headers.find?.(h => h.Name === 'References')?.Value || ''

    if (!fromEmail && !payload.from_email) {
        return { statusCode: 400, body: JSON.stringify({ error: 'from_email is required' }) }
    }

    // -- DEDUP GUARD: Postmark retries on 5xx. Return 200 immediately if we already
    // processed this exact message ID so retries are no-ops, not duplicate emails.
    const incomingMessageId = payload?.MessageID
    if (incomingMessageId) {
        const { data: existingEmail } = await getDB()
            .from('emails')
            .select('id')
            .eq('message_id', incomingMessageId)
            .eq('direction', 'inbound')
            .maybeSingle()
        if (existingEmail) {
            console.log('[email-inbound] Duplicate webhook for message_id ' + incomingMessageId + ' - skipping')
            return { statusCode: 200, body: JSON.stringify({ ok: true, duplicate: true }) }
        }
    }

    const counterpartyEmail = fromEmail || payload.from_email
    const emailBody = body || payload.body || ''

    try {
        let threadId = existingThreadId

        if (!threadId) {
            // 1. Best match: find thread via In-Reply-To / References header
            //    (matches the Message-ID of an email we sent previously)
            if (inReplyTo || referencesHeader) {
                const msgIds = [inReplyTo, ...referencesHeader.split(/\s+/)].filter(Boolean)
                for (const msgId of msgIds) {
                    const { data: match } = await getDB()
                        .from('emails')
                        .select('thread_id')
                        .eq('message_id', msgId)
                        .maybeSingle()
                    if (match?.thread_id) { threadId = match.thread_id; break }
                }
            }

            // 2. Fallback: match by counterparty email + subject
            if (!threadId) {
                const baseSubject = subject.replace(/^(re:|fwd?:)\s*/gi, '').trim()
                const { data: existing } = await getDB()
                    .from('email_threads')
                    .select('id')
                    .eq('counterparty_email', counterpartyEmail)
                    .ilike('subject', `%${baseSubject}%`)
                    .eq('status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
                if (existing) threadId = existing.id
            }

            // 3. No match � create a new thread
            if (!threadId) {
                const { data: session } = await getDB()
                    .from('sessions')
                    .insert({ domain, transcript: [], config_snapshot: { mode } })
                    .select().single()
                const { data: thread } = await getDB()
                    .from('email_threads')
                    .insert({ subject, counterparty_email: counterpartyEmail, domain, session_id: session?.id, mode })
                    .select().single()
                threadId = thread.id
            }
        }

        // Load thread record � including all intelligence columns
        const { data: threadRecord } = await getDB()
            .from('email_threads')
            .select('mode, domain, counterparty_intel, counterparty_profile, thread_state')
            .eq('id', threadId)
            .single()
        const threadMode = threadRecord?.mode || mode
        const threadDomain = threadRecord?.domain || domain
        const counterpartyIntel = threadRecord?.counterparty_intel || {}
        const counterpartyProfile = threadRecord?.counterparty_profile || {}
        const threadState = threadRecord?.thread_state || {}
        const isFirstEmail = Object.keys(counterpartyIntel).length === 0

        // -- CROSS-NEGOTIATION MEMORY + VOICE CONTEXT � Parallel fetch ------
        let priorHistoryBlock = ''
        let voiceContextBlock = ''

        const [priorThreadsResult, voiceSessionsResult] = await Promise.all([
            counterpartyEmail
                ? getDB()
                    .from('email_threads')
                    .select('id, subject, domain, counterparty_profile, counterparty_intel, thread_state, created_at')
                    .eq('counterparty_email', counterpartyEmail)
                    .neq('id', threadId)
                    .order('created_at', { ascending: false })
                    .limit(5)
                : Promise.resolve({ data: null }),
            getDB()
                .from('voice_sessions')
                .select('title, counterparty_name, duration_ms, analysis, emotion_timeline, created_at')
                .eq('thread_id', threadId)
                .eq('status', 'analyzed')
                .order('created_at', { ascending: false })
                .limit(3),
        ])

        // Process cross-negotiation memory
        if (priorThreadsResult.data && priorThreadsResult.data.length > 0) {
            const priorThreads = priorThreadsResult.data
            try {
                const priorInsights = priorThreads.map(pt => {
                    const profile = pt.counterparty_profile || {}
                    const state = pt.thread_state || {}
                    return `  PRIOR THREAD: "${pt.subject}" (${pt.domain || 'General'})
    Style: ${profile.communication_style || 'Unknown'}
    Personality: ${profile.personality_type || 'Unknown'}
    Ego: ${profile.ego_sensitivity || 'Unknown'}
    Authority: ${profile.decision_authority || 'Unknown'}
    Pressure points: ${profile.detected_pressure_points?.join(', ') || 'None'}
    Tells: ${profile.tells?.join(', ') || 'None'}
    Bluff signals: ${profile.bluff_signals_seen?.join(', ') || 'None'}
    Game plan used: ${state.strategic_game_plan || 'Unknown'}`
                }).join('\n\n')

                priorHistoryBlock = `
?????????????????????????????????????????????????????????
CROSS-NEGOTIATION MEMORY � YOU HAVE DEALT WITH THIS PERSON BEFORE
Use this intelligence to anticipate their moves. People are creatures of habit.
?????????????????????????????????????????????????????????
${priorInsights}
`
                if (Object.keys(counterpartyProfile).length === 0 && priorThreads[0].counterparty_profile) {
                    const priorProfile = priorThreads[0].counterparty_profile
                    getDB().from('email_threads')
                        .update({ counterparty_profile: priorProfile })
                        .eq('id', threadId)
                        .then(() => console.log('[cross-memory] Merged prior profile into thread', threadId))
                        .catch(err => console.error('[cross-memory] merge failed:', err.message))
                }
            } catch (memErr) {
                console.error('[cross-memory] failed:', memErr.message)
            }
        }

        // Process voice context from parallel fetch
        if (voiceSessionsResult.data && voiceSessionsResult.data.length > 0) {
            try {
                const voiceSessions = voiceSessionsResult.data
                const callSummaries = voiceSessions.map(vs => {
                    const a = vs.analysis || {}
                    const durationMin = vs.duration_ms ? `${Math.round(vs.duration_ms / 60000)}m` : 'unknown duration'
                    const callDate = new Date(vs.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    const emotionHighlights = (vs.emotion_timeline || [])
                        .filter(e => e.score > 0.6).slice(0, 4)
                        .map(e => `${e.speaker} showed ${e.top_emotion} (${Math.round(e.score * 100)}%)`)
                        .join('; ')
                    const contradictions = (a.email_contradictions || [])
                        .map(c => `� They said "${c.they_said_on_call}" on call but "${c.they_said_in_email}" in email (bluff probability ${Math.round((c.bluff_probability || 0) * 100)}%)`)
                        .join('\n')
                    return `CALL ON ${callDate} (${durationMin}) � Score: ${a.negotiation_score || '?'}/100 � Outcome: ${a.outcome_assessment || 'unknown'}
  Techniques THEY used: ${(a.techniques_they_used || []).join(', ') || 'None detected'}
  Techniques ARCHI used: ${(a.techniques_archi_used || []).join(', ') || 'unknown'}
  Emotion signals: ${emotionHighlights || 'None noted'}
  What worked: ${a.what_worked || 'N/A'}
  Recommended next move: ${a.what_to_do_next || 'N/A'}${
    contradictions ? `\n  ?? CONTRADICTIONS BETWEEN CALL AND EMAIL:\n${contradictions}` : ''
  }`
                }).join('\n\n')
                voiceContextBlock = `
????????????????????????????????????????????????????????
VOICE CALL INTELLIGENCE � CRITICAL: READ BEFORE DRAFTING
This counterparty has spoken with ARCHI by phone. Use this intelligence.
????????????????????????????????????????????????????????
${callSummaries}
`
                console.log(`[voice-context] Injecting ${voiceSessions.length} call(s) into thread ${threadId} prompt`)
            } catch (voiceErr) {
                console.error('[voice-context] failed (non-blocking):', voiceErr.message)
            }
        }

        // Load thread history + all learned patterns in parallel
        const [{ data: threadEmails }, learnedPatterns] = await Promise.all([
            getDB().from('emails')
                .select('direction, body, claude_analysis, created_at')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true }),
            fetchLearnedPatterns(),
        ])

        // Trigger counterparty research on first email (fire-and-forget, non-blocking)
        if (isFirstEmail && counterpartyEmail) {
            fetch(`${process.env.URL}/.netlify/functions/research-counterparty`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
            },
                body: JSON.stringify({ thread_id: threadId, from_email: counterpartyEmail, from_name: '' }),
            }).catch(err => console.error('[research-counterparty] fire-and-forget failed:', err.message))

            // Auto-draft our position brief � fire-and-forget (non-blocking, adds ~1.5s if awaited)
            ;(async () => {
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

Be specific � use numbers and dates if you can infer them. If the email is vague, make reasonable assumptions.

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
  "tone": "recommended tone � collaborative | assertive | exploratory | firm"
}`

                    const briefRes = await anthropic.messages.create({
                        model: MODEL_HAIKU,
                        max_tokens: 800,
                        messages: [{ role: 'user', content: briefPrompt }],
                    })

                    let ourPosition = null
                    try {
                        const raw = briefRes.content[0]?.text || ''
                        const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
                        ourPosition = JSON.parse(match ? match[1].trim() : raw.trim())
                    } catch {
                        console.error('[brief-draft] JSON parse failed')
                    }

                    if (ourPosition) {
                        await getDB().from('email_threads')
                            .update({ our_position: ourPosition, position_confirmed: false })
                            .eq('id', threadId)
                        console.log('[brief-draft] position brief saved for thread', threadId)
                    }
                } catch (briefErr) {
                    console.error('[brief-draft] failed:', briefErr.message)
                }
            })()
        }

        // Compute email meta-signals for the prompt
        const lastOutbound = (threadEmails || []).filter(e => e.direction === 'outbound').pop()
        const responseTimeDeltaMs = lastOutbound?.created_at
            ? Date.now() - new Date(lastOutbound.created_at).getTime()
            : null
        const emailBodyClean = emailBody || htmlBody.replace(/<[^>]+>/g, '') || ''
        const wordCount = emailBodyClean.split(/\s+/).filter(Boolean).length
        const prevWordCounts = (threadEmails || []).filter(e => e.direction === 'inbound').map(e => e.body?.split(/\s+/).length || 0)
        const avgPrev = prevWordCounts.length ? prevWordCounts.reduce((a, b) => a + b, 0) / prevWordCounts.length : 0
        const wordCountTrend = avgPrev === 0 ? 'baseline' : wordCount > avgPrev * 1.4 ? 'longer than usual (anxiety/over-justification?)' : wordCount < avgPrev * 0.6 ? 'shorter than usual (power play?)' : 'normal'
        const iWeCount = (emailBodyClean.match(/\bI\b/g) || []).length
        const weCount = (emailBodyClean.match(/\bwe\b/gi) || []).length
        const pronounPattern = iWeCount > weCount * 2 ? 'Heavy I � speaking personally, not for group' : weCount > iWeCount * 2 ? 'Heavy we � speaking for group or hiding behind it' : 'Mixed � standard'
        const sentDay = new Date().toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
        const emailMeta = {
            responseTimeDeltaHrs: responseTimeDeltaMs != null ? responseTimeDeltaMs / 3600000 : null,
            wordCount,
            wordCountTrend,
            pronounPattern,
            dayTime: sentDay,
            ccChanges: 'not tracked via Postmark inbound',
        }

        // Compute scheduled send timing
        const urgencyScore = 0.5  // pre-Claude default; actual score computed after analysis at line 590
        const { scheduledSendAt } = computeScheduledSendTime(threadDomain, new Date().toISOString(), responseTimeDeltaMs, urgencyScore)

        // Process attachments � PDFs go natively to Claude, DOCX/TXT extracted as text
        const allAttachments = await processAttachments(attachments)
        const pdfAttachments = allAttachments.filter(a => a.type === 'pdf')
        const textAttachments = allAttachments.filter(a => a.type === 'text')
        const hasAttachments = allAttachments.length > 0

        // Run Claude negotiation analysis + draft reply
        let prompt = buildEmailNegotiatorPrompt(
            threadEmails || [], emailBodyClean, threadDomain, textAttachments, learnedPatterns,
            counterpartyIntel, counterpartyProfile, threadState, emailMeta
        )
        // Inject cross-platform context: prior negotiation memory + voice calls
        if (priorHistoryBlock) {
            prompt = priorHistoryBlock + '\n' + prompt
        }
        if (voiceContextBlock) {
            prompt = voiceContextBlock + '\n' + prompt
        }

        // Build message content � PDFs passed as native Claude document blocks
        const userContent = [
            // Native PDF documents (Claude reads these directly)
            ...pdfAttachments.map(pdf => ({
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 },
                title: pdf.name,
                cache_control: { type: 'ephemeral' },
            })),
            // Text prompt with playbook + thread history + any DOCX content
            { type: 'text', text: prompt },
        ]

        const claudeRes = await anthropic.messages.create({
            model: MODEL_HAIKU,
            max_tokens: hasAttachments ? 6000 : 3000,
            messages: [{ role: 'user', content: userContent }],
        })

        let analysis = {}
        try {
            const raw = claudeRes.content[0]?.text || ''
            const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
            analysis = JSON.parse(match ? match[1].trim() : raw.trim())
        } catch {
            analysis = { drafted_reply: claudeRes.content[0]?.text || '', technique_detected: 'unknown' }
        }

        // -- Detect Claude safety refusals ------------------------------------
        // Claude sometimes refuses if the system prompt language triggers safety filters.
        // If this happens, DO NOT save the refusal as a drafted reply � hold the email for manual review.
        function isClaudeRefusal(text) {
            if (!text) return false
            const lower = text.toLowerCase()
            const refusalSignals = [
                "i won't", "i will not", "i'm not going to", "i cannot", "i can't",
                "i refuse", "i'm declining", "this is manipulation", "psychological manipulation",
                "i've been clear", "i've already declined", "not going to complete",
                "what you've built", "systematizing deception", "won't roleplay",
                "i won't do that", "that's not something i",
            ]
            return refusalSignals.some(sig => lower.includes(sig))
        }

        const rawDraft = analysis.drafted_reply || ''
        const draftIsRefusal = isClaudeRefusal(rawDraft)
        if (draftIsRefusal) {
            console.warn('[email-inbound] Claude safety refusal detected � holding email, not scheduling send')
        }

        // Compute scheduled send time using actual bluff_probability from Claude
        const actualUrgencyScore = analysis.bluff_probability != null ? 1 - analysis.bluff_probability : 0.5
        const { scheduledSendAt: finalScheduledSendAt, waitHours } = computeScheduledSendTime(
            threadDomain, new Date().toISOString(), responseTimeDeltaMs, actualUrgencyScore
        )

        // Strip any accidental JSON/code fence wrapping from drafted_reply
        function cleanDraftedReply(raw) {
            if (!raw) return ''
            const fenceMatch = raw.match(/```(?:json)?\s*[\s\S]*?```/)
            if (fenceMatch) {
                // Claude returned a code block � try extracting drafted_reply from it
                try {
                    const inner = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
                    const parsed = JSON.parse(inner ? inner[1].trim() : raw.trim())
                    return parsed.drafted_reply || raw
                } catch { return raw }
            }
            // If it starts with { it's probably raw JSON � try to extract drafted_reply
            if (raw.trimStart().startsWith('{')) {
                try {
                    const parsed = JSON.parse(raw.trim())
                    if (parsed.drafted_reply) return parsed.drafted_reply
                } catch { /* not JSON, use as-is */ }
            }
            return raw
        }

        const { data: savedEmail, error: saveErr } = await getDB()
            .from('emails')
            .insert({
                thread_id: threadId,
                direction: 'inbound',
                from_email: counterpartyEmail,
                to_email: process.env.GMAIL_USER || 'jdquist2025@gmail.com', // always OUR address, not Postmark hash
                subject,
                body: emailBodyClean,
                message_id: messageId || null,
                claude_analysis: analysis,
                drafted_reply: draftIsRefusal ? '' : cleanDraftedReply(analysis.drafted_reply),
                status: 'pending',
                scheduled_send_at: draftIsRefusal ? null : finalScheduledSendAt,
                send_status: draftIsRefusal ? 'hold' : 'scheduled',
            })
            .select().single()
        if (saveErr) console.error('[email-inbound] email insert error:', saveErr.message)

        // Persist counterparty profile + thread state updates from this analysis
        const profileUpdate = analysis.counterparty_profile_update
        const stateUpdate = analysis.thread_state_update
        const threadUpdates = { updated_at: new Date().toISOString() }
        if (profileUpdate) {
            // Merge new profile data with existing (arrays accumulate, scalars overwrite)
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
            // Accumulate thread_observations (keep last 20)
            if (stateUpdate.thread_observations) {
                const existing = threadState.thread_observations || []
                mergedState.thread_observations = [...existing, ...stateUpdate.thread_observations].slice(-20)
            }
            // Accumulate concessions
            if (stateUpdate.concessions_we_made)
                mergedState.concessions_we_made = [...(threadState.concessions_we_made || []), ...stateUpdate.concessions_we_made]
            if (stateUpdate.concessions_they_made)
                mergedState.concessions_they_made = [...(threadState.concessions_they_made || []), ...stateUpdate.concessions_they_made]
            threadUpdates.thread_state = mergedState
        }
        await getDB().from('email_threads').update(threadUpdates).eq('id', threadId)

        // -- AUTO-REFLECTION + AUTONOMOUS LEARNING -----------------------------
        // Self-eval after every exchange ? updates pattern scores ? discovers new patterns
        try {
            const lastOurEmail = (threadEmails || []).filter(e => e.direction === 'outbound').pop()
            if (lastOurEmail) {
                const reflectPrompt = `You are reviewing a negotiation exchange. Evaluate briefly.

OUR LAST EMAIL:
${lastOurEmail.body?.slice(0, 800) || 'N/A'}

THEIR REPLY:
${emailBodyClean.slice(0, 800)}

OUR GOAL: ${threadRecord?.our_position?.goal || 'Unknown'}

Respond with ONLY valid JSON:
{
  "did_advance": true/false,
  "progress_score": 0-100,
  "what_worked": "one line � what about our last move was effective",
  "what_failed": "one line � what we should have done differently (null if n/a)",
  "signal_changes": "one line � what changed in their posture/tone/urgency",
  "recommended_adjustment": "one line � tactical adjustment for next move"
}`

                const reflectRes = await anthropic.messages.create({
                    model: MODEL_HAIKU,
                    max_tokens: 400,
                    messages: [{ role: 'user', content: reflectPrompt }],
                })

                let reflection = null
                try {
                    const raw = reflectRes.content[0]?.text || ''
                    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
                    reflection = JSON.parse(match ? match[1].trim() : raw.trim())
                } catch { /* ignore parse errors */ }

                if (reflection) {
                    const existingLog = threadState.reflection_log || []
                    existingLog.push({
                        ...reflection,
                        patterns_used: analysis.patterns_used || [],
                        exchange_number: (threadEmails || []).length,
                        timestamp: new Date().toISOString(),
                    })
                    await getDB().from('email_threads')
                        .update({ thread_state: { ...(threadUpdates.thread_state || threadState), reflection_log: existingLog.slice(-20) } })
                        .eq('id', threadId)
                    console.log('[auto-reflect] reflection stored for thread', threadId, '� progress:', reflection.progress_score)

                    // -- PATTERN SCORE UPDATE (Autonomous Learning) --------------
                    // Boost patterns that worked, penalize ones that didn't
                    const patternsUsed = analysis.patterns_used || []
                    if (patternsUsed.length > 0) {
                        const scoreChange = reflection.did_advance ? 0.03 : -0.02
                        for (const patternRef of patternsUsed) {
                            // Try matching by ID first, then by tactic name
                            const { data: matchedPattern } = await getDB()
                                .from('learned_patterns')
                                .select('id, confidence_score')
                                .or(`id.eq.${patternRef},tactic_used.ilike.%${String(patternRef).slice(0, 40)}%`)
                                .limit(1).single()
                            if (matchedPattern) {
                                const newScore = Math.max(0.20, Math.min(0.99, (matchedPattern.confidence_score || 0.7) + scoreChange))
                                await getDB().from('learned_patterns')
                                    .update({
                                        confidence_score: parseFloat(newScore.toFixed(3)),
                                        last_validated_at: new Date().toISOString(),
                                    })
                                    .eq('id', matchedPattern.id)
                            }
                        }
                        console.log(`[auto-learn] updated ${patternsUsed.length} patterns � advance=${reflection.did_advance} change=${scoreChange}`)
                    }

                    // -- SELF-GENERATED PATTERNS (Novel Tactic Discovery) ---------
                    // When ARCHI discovers a new tactic that works, create a new pattern
                    if (reflection.did_advance && analysis.novel_tactic && analysis.novel_tactic !== 'null') {
                        await getDB().from('learned_patterns').insert({
                            source_type: 'self_discovered',
                            domain: threadDomain || 'General',
                            situation_type: `Exchange ${(threadEmails || []).length} � counterparty used ${analysis.technique_detected || 'unknown tactic'}`,
                            tactic_used: analysis.novel_tactic,
                            what_worked: reflection.what_worked,
                            what_failed: reflection.what_failed || null,
                            lesson: `Self-discovered during live negotiation: ${analysis.novel_tactic}`,
                            outcome_type: 'unknown',
                            source_thread_id: threadId,
                            confidence_score: 0.60,
                        })
                        console.log('[auto-learn] NEW SELF-DISCOVERED PATTERN:', analysis.novel_tactic)
                    }
                }
            }
        } catch (reflectErr) {
            console.error('[auto-reflect] failed (non-blocking):', reflectErr.message)
        }

        // --- AUTONOMOUS MODE CIRCUIT BREAKERS -------------------------------
        // Prevent infinite loops, runaway sends, and stalled conversations
        if (threadMode === 'autonomous' && analysis.drafted_reply && savedEmail?.id) {
            let blocked = false
            let blockReason = ''

            // 1. DUPLICATE DETECTION � don't reply to the same message twice
            const recentInbound = (threadEmails || [])
                .filter(e => e.direction === 'inbound')
                .slice(-5)
            const isDuplicate = recentInbound.some(e =>
                e.body?.trim().toLowerCase() === emailBodyClean.trim().toLowerCase()
            )
            if (isDuplicate) {
                blocked = true
                blockReason = 'duplicate_message'
            }

            // 2. VELOCITY LIMITER � max 8 outbound emails per thread per 24 hours
            if (!blocked) {
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
                const { count: recentSentCount } = await getDB()
                    .from('emails')
                    .select('id', { count: 'exact', head: true })
                    .eq('thread_id', threadId)
                    .eq('direction', 'outbound')
                    .gte('created_at', oneDayAgo)
                if ((recentSentCount || 0) >= 8) {
                    blocked = true
                    blockReason = 'velocity_limit'
                }
            }

            // 3. STALL DETECTION � last 3 inbound messages are identical = stuck loop
            if (!blocked) {
                const lastThreeInbound = (threadEmails || [])
                    .filter(e => e.direction === 'inbound')
                    .slice(-3)
                if (lastThreeInbound.length === 3) {
                    const bodies = lastThreeInbound.map(e => e.body?.trim().toLowerCase())
                    const allSame = bodies.every(b => b === bodies[0])
                    if (allSame) {
                        blocked = true
                        blockReason = 'stall_detected'
                    }
                }
            }

            if (blocked) {
                console.warn(`[autonomous-blocked] thread=${threadId} reason=${blockReason}`)
                // Switch thread to coached mode so human reviews
                await getDB()
                    .from('email_threads')
                    .update({ mode: 'coached', updated_at: new Date().toISOString() })
                    .eq('id', threadId)
                // Update email status to flag for review
                await getDB()
                    .from('emails')
                    .update({ status: `paused:${blockReason}` })
                    .eq('id', savedEmail.id)
            } else {
                // All clear � auto-send
                await fetch(`${process.env.URL}/.netlify/functions/email-send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
            },
                    body: JSON.stringify({ email_id: savedEmail.id }),
                }).catch(() => { })
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
            },
            body: JSON.stringify({
                thread_id: threadId,
                email_id: savedEmail.id,
                technique_detected: analysis.technique_detected,
                drafted_reply: analysis.drafted_reply,
                status: threadMode === 'autonomous' ? 'auto_sent' : 'pending_review',
            }),
        }
    } catch (err) {
        console.error('[email-inbound]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
