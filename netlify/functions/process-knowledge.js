/**
 * Netlify Function: process-knowledge
 * POST /api/process-knowledge
 * Takes a knowledge_sources row, runs Claude to extract patterns ? learned_patterns.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin, MODEL_HAIKU } from './fnUtils.js'

// Netlify function config  extend timeout for LLM processing
export const config = { path: "/api/process-knowledge" }

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

    const { knowledge_id } = body
    if (!knowledge_id) return { statusCode: 400, body: 'knowledge_id required' }

    const { data: source, error } = await getDB()
        .from('knowledge_sources')
        .select('*')
        .eq('id', knowledge_id)
        .single()

    if (error || !source) return { statusCode: 404, body: 'Knowledge source not found' }

    const prompt = `You are a master negotiation coach extracting tactical wisdom from a ${source.source_type} source.

SOURCE TITLE: ${source.title}
DOMAIN TAGS: ${(source.domain_tags || []).join(', ') || 'General'}

SOURCE TEXT:
${source.content_text.slice(0, 60000)}

Extract every specific, actionable negotiation lesson from this source.
Focus on: specific situations that trigger tactics, what the tactic is, what outcome it produces.
Each lesson must be concrete and reusable  no generalities.
Aim for 5-15 patterns depending on the richness of the source.

Respond with valid JSON only:
{
  "patterns": [
    {
      "domain": "Real Estate / M&A / Salary / General / etc.",
      "situation_type": "specific situation that triggers this tactic",
      "tactic_used": "the specific tactic or move",
      "what_worked": "what this approach achieves and why it works",
      "what_failed": "known failure modes or when NOT to use (null if n/a)",
      "lesson": "single most important reusable insight",
      "outcome_type": "win/partial/loss/unknown",
      "confidence_score": 0.9
    }
  ]
}`

    const claudeRes = await anthropic.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
    })

    let patterns = []
    try {
        const raw = claudeRes.content[0]?.text || ''
        const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
        const parsed = JSON.parse(match ? match[1].trim() : raw.trim())
        patterns = parsed.patterns || []
    } catch (err) {
        console.error('[process-knowledge] parse error:', err.message)
        return { statusCode: 500, body: JSON.stringify({ error: 'parse_failed', raw: claudeRes.content[0]?.text?.slice(0, 500) }) }
    }

    const patternRows = patterns.map(p => ({
        source_type: source.source_type === 'historical' ? 'historical' : 'research',
        domain: p.domain || (source.domain_tags?.[0]) || 'General',
        situation_type: p.situation_type,
        tactic_used: p.tactic_used,
        what_worked: p.what_worked,
        what_failed: p.what_failed,
        lesson: p.lesson,
        outcome_type: p.outcome_type || 'unknown',
        source_knowledge_id: knowledge_id,
        confidence_score: p.confidence_score || 0.8,
    }))

    await getDB().from('learned_patterns').insert(patternRows)
    await getDB().from('knowledge_sources').update({
        processed: true,
        pattern_count: patternRows.length,
    }).eq('id', knowledge_id)

    return {
        statusCode: 200,
        body: JSON.stringify({ patterns_extracted: patternRows.length }),
    }
}
