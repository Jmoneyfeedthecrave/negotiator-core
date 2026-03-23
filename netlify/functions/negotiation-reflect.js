/**
 * Netlify Function: negotiation-reflect
 * POST /api/negotiation-reflect
 * Called when user marks a thread outcome.
 * Claude analyses the full thread, extracts lessons ? stored in learned_patterns.
 */

import Anthropic from '@anthropic-ai/sdk'
$args[0].Groups[1].Value + $args[0].Groups[2].Value + ", handleOptions" + $args[0].Groups[3].Value

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
    if (event.httpMethod === 'OPTIONS') return handleOptions()
    const authErr = requireAuth(event); if (authErr) return authErr

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

    const { thread_id, outcome, deal_value, notes } = body
    if (!thread_id || !outcome) return { statusCode: 400, body: 'thread_id and outcome required' }

    // Save the outcome record
    const { data: outcomeRecord, error: outcomeError } = await getDB()
        .from('negotiation_outcomes')
        .insert({ thread_id, outcome, deal_value: deal_value || null, notes: notes || null })
        .select().single()

    if (outcomeError) return { statusCode: 500, body: outcomeError.message }

    // Load the full thread
    const { data: thread } = await getDB()
        .from('email_threads')
        .select('domain, counterparty_email, subject')
        .eq('id', thread_id).single()

    const { data: emails } = await getDB()
        .from('emails')
        .select('direction, body, claude_analysis, created_at')
        .eq('thread_id', thread_id)
        .order('created_at', { ascending: true })

    if (!emails || emails.length === 0) return { statusCode: 200, body: JSON.stringify({ outcome_id: outcomeRecord.id, patterns: 0 }) }

    const threadLog = emails.map((e, i) =>
        `[${i + 1}] ${e.direction === 'inbound' ? 'THEM' : 'US'}: ${e.body?.slice(0, 800) || ''}`
    ).join('\n\n')

    const prompt = `You are a master negotiation coach reviewing a completed negotiation.

NEGOTIATION DOMAIN: ${thread?.domain || 'General'}
COUNTERPARTY: ${thread?.counterparty_email || 'Unknown'}
SUBJECT: ${thread?.subject || 'Unknown'}
FINAL OUTCOME: ${outcome.toUpperCase()}${deal_value ? ` — Deal value: $${deal_value}` : ''}
${notes ? `USER NOTES: ${notes}` : ''}

FULL NEGOTIATION TRANSCRIPT:
${threadLog}

Analyze this negotiation and extract 3-6 highly specific, actionable lessons. 
Focus on: what tactics worked, what failed, what signals were missed, what we'd do differently.
Be brutally honest. Generic observations are worthless. Only specific, reusable insights.

Respond with valid JSON only:
{
  "patterns": [
    {
      "situation_type": "one-line description of the situation that triggers this lesson",
      "tactic_used": "specific tactic or approach used",
      "what_worked": "what specifically worked and why",
      "what_failed": "what specifically failed and why (null if n/a)",
      "lesson": "the single most important reusable insight from this moment",
      "outcome_type": "${outcome}",
      "confidence_score": 0.85
    }
  ]
}`

    const claudeRes = await anthropic.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
    })

    let patterns = []
    try {
        const raw = claudeRes.content[0]?.text || ''
        const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
        const parsed = JSON.parse(match ? match[1].trim() : raw.trim())
        patterns = parsed.patterns || []
    } catch (err) {
        console.error('[reflect] parse error:', err.message)
        return { statusCode: 200, body: JSON.stringify({ outcome_id: outcomeRecord.id, patterns: 0, error: 'parse_failed' }) }
    }

    // Store each pattern
    const patternRows = patterns.map(p => ({
        source_type: 'own_negotiation',
        domain: thread?.domain || 'General',
        situation_type: p.situation_type,
        tactic_used: p.tactic_used,
        what_worked: p.what_worked,
        what_failed: p.what_failed,
        lesson: p.lesson,
        outcome_type: p.outcome_type,
        source_thread_id: thread_id,
        confidence_score: p.confidence_score || 0.75,
    }))

    const { error: insertError } = await getDB().from('learned_patterns').insert(patternRows)
    if (insertError) console.error('[reflect] insert error:', insertError.message)

    // -- OUTCOME-DRIVEN PATTERN SCORING ----------------------------------
    // Scan all emails in this thread for patterns_used and boost/penalize them
    try {
        const allPatternsUsed = new Set()
        for (const email of emails) {
            const emailAnalysis = email.claude_analysis
            if (emailAnalysis?.patterns_used && Array.isArray(emailAnalysis.patterns_used)) {
                emailAnalysis.patterns_used.forEach(p => allPatternsUsed.add(p))
            }
        }

        if (allPatternsUsed.size > 0) {
            const scoreMap = { win: 0.10, partial: 0.03, loss: -0.08, stalemate: -0.02 }
            const change = scoreMap[outcome] || 0

            for (const patternRef of allPatternsUsed) {
                const { data: matched } = await getDB()
                    .from('learned_patterns')
                    .select('id, confidence_score')
                    .or(`id.eq.${patternRef},tactic_used.ilike.%${String(patternRef).slice(0, 40)}%`)
                    .limit(1).single()
                if (matched) {
                    const newScore = Math.max(0.20, Math.min(0.99, (matched.confidence_score || 0.7) + change))
                    await getDB().from('learned_patterns')
                        .update({
                            confidence_score: parseFloat(newScore.toFixed(3)),
                            last_validated_at: new Date().toISOString(),
                        })
                        .eq('id', matched.id)
                }
            }
            console.log(`[reflect] outcome-scored ${allPatternsUsed.size} patterns — outcome=${outcome} change=${change}`)
        }
    } catch (scoreErr) {
        console.error('[reflect] pattern scoring failed (non-blocking):', scoreErr.message)
    }

    // Mark outcome as reflected
    await getDB().from('negotiation_outcomes').update({ reflected: true }).eq('id', outcomeRecord.id)

    return {
        statusCode: 200,
        body: JSON.stringify({ outcome_id: outcomeRecord.id, patterns: patternRows.length }),
    }
}
