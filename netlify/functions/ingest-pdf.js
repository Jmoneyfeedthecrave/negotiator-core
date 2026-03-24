/**
 * Netlify Function: ingest-pdf
 * POST /api/ingest-pdf
 * Accepts base64-encoded PDF, uses Claude to extract text, creates knowledge_source, auto-processes.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin, MODEL_HAIKU } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

    const { pdf_base64, title, source_type = 'research', domain_tags = [] } = body
    if (!pdf_base64) return { statusCode: 400, body: JSON.stringify({ error: 'pdf_base64 is required' }) }

    try {
        // Use Claude's native PDF reading to extract text
        const extractRes = await anthropic.messages.create({
            model: MODEL_HAIKU,
            max_tokens: 8000,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'document',
                        source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 },
                    },
                    {
                        type: 'text',
                        text: 'Extract ALL the readable text content from this PDF document. Return ONLY the extracted text, preserving headings and paragraph structure. Do not add commentary or analysis.',
                    },
                ],
            }],
        })

        const extractedText = extractRes.content[0]?.text || ''
        if (extractedText.length < 50) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Failed to extract meaningful content from PDF' }) }
        }

        const finalText = extractedText.slice(0, 80000)
        const autoTitle = title || 'PDF Upload — ' + new Date().toISOString().slice(0, 10)

        // Create knowledge source
        const { data: source, error: insertErr } = await getDB()
            .from('knowledge_sources')
            .insert({
                title: autoTitle,
                source_type,
                domain_tags: Array.isArray(domain_tags) ? domain_tags : domain_tags.split(',').map(t => t.trim()).filter(Boolean),
                content_text: finalText,
            })
            .select().single()

        if (insertErr) throw new Error(insertErr.message)

        // Auto-trigger processing
        fetch(`${process.env.URL}/.netlify/functions/process-knowledge`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ARCHI_API_KEY ? { 'x-archi-api-key': process.env.ARCHI_API_KEY } : {}),
            },
            body: JSON.stringify({ knowledge_id: source.id }),
        }).catch(err => console.error('[ingest-pdf] auto-process failed:', err.message))

        return {
            statusCode: 200,
            body: JSON.stringify({
                source_id: source.id,
                title: autoTitle,
                chars_extracted: finalText.length,
                status: 'processing',
            }),
        }
    } catch (err) {
        console.error('[ingest-pdf]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
