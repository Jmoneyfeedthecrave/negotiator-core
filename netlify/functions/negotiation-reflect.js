/**
 * Netlify Function: negotiation-reflect
 * POST /api/negotiation-reflect
 * Called when user marks a thread outcome.
 * Claude analyses the full thread, extracts lessons → stored in learned_patterns.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

    const { thread_id, outcome, deal_value, notes } = body
    if (!thread_id || !outcome) return { statusCode: 400, body: 'thread_id and outcome required' }

    // Save the outcome record
    const { data: outcomeRecord, error: outcomeError } = await supabase
        .from('negotiation_outcomes')
        .insert({ thread_id, outcome, deal_value: deal_value || null, notes: notes || null })
        .select().maybeSingle()

    if (outcomeError) return { statusCode: 500, body: outcomeError.message }

    // Load the full thread
    const { data: thread } = await supabase
        .from('email_threads')
        .select('domain, counterparty_email, subject')
        .eq('id', thread_id).maybeSingle()

    const { data: emails } = await supabase
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
        model: 'claude-opus-4-7',
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

    const { error: insertError } = await supabase.from('learned_patterns').insert(patternRows)
    if (insertError) console.error('[reflect] insert error:', insertError.message)

    // Mark outcome as reflected
    await supabase.from('negotiation_outcomes').update({ reflected: true }).eq('id', outcomeRecord.id)

    return {
        statusCode: 200,
        body: JSON.stringify({ outcome_id: outcomeRecord.id, patterns: patternRows.length }),
    }
}
