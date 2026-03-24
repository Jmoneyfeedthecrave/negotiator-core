/**
 * Netlify Function: ingest-url
 * POST /api/ingest-url
 * Fetches a URL, extracts readable text, creates knowledge_source, auto-processes.
 */

import { getSupabaseAdmin } from './fnUtils.js'

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

    let body
    try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

    const { url, title, source_type = 'research', domain_tags = [] } = body
    if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'url is required' }) }

    try {
        // Fetch the page
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ARCHI-Bot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,text/plain',
            },
            signal: AbortSignal.timeout(15000),
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

        const contentType = res.headers.get('content-type') || ''
        const rawText = await res.text()

        // Convert HTML to plain text
        const extractedText = contentType.includes('text/html')
            ? htmlToText(rawText)
            : rawText

        if (extractedText.length < 100) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Page too short or failed to extract meaningful content' }) }
        }

        // Truncate to 80k chars to stay within Claude limits
        const finalText = extractedText.slice(0, 80000)
        const autoTitle = title || new URL(url).hostname + ' — ' + url.split('/').pop()

        // Create knowledge source
        const { data: source, error: insertErr } = await getDB()
            .from('knowledge_sources')
            .insert({
                title: autoTitle,
                source_type,
                domain_tags: Array.isArray(domain_tags) ? domain_tags : domain_tags.split(',').map(t => t.trim()).filter(Boolean),
                content_text: finalText,
                source_url: url,
            })
            .select().single()

        if (insertErr) throw new Error(insertErr.message)

        // Auto-trigger processing (fire-and-forget)
        fetch(`${process.env.URL}/.netlify/functions/process-knowledge`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ARCHI_API_KEY ? { 'x-archi-api-key': process.env.ARCHI_API_KEY } : {}),
            },
            body: JSON.stringify({ knowledge_id: source.id }),
        }).catch(err => console.error('[ingest-url] auto-process failed:', err.message))

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
        console.error('[ingest-url]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
