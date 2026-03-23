/**
 * Netlify Function: research-counterparty
 * POST /api/research-counterparty
 * Uses Tavily Search API to research the counterparty company + person.
 * Stores results in email_threads.counterparty_intel JSONB.
 * Called on first email in any new thread.
 */

$args[0].Groups[1].Value + $args[0].Groups[2].Value + ", handleOptions" + $args[0].Groups[3].Value

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }
const TAVILY_API_KEY = process.env.TAVILY_API_KEY

async function tavilySearch(query, maxResults = 5) {
    try {
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: TAVILY_API_KEY,
                query,
                search_depth: 'advanced',
                max_results: maxResults,
                include_answer: true,
                include_raw_content: false,
            })
        })
        const data = await res.json()
        return data.answer || data.results?.map(r => r.content).join(' ') || ''
    } catch (err) {
        console.error('[tavily] search error:', err.message)
        return ''
    }
}

function extractDomain(email) {
    const match = email.match(/@([^>]+)/)
    return match ? match[1].trim().toLowerCase() : ''
}

function extractName(fromHeader) {
    // "John Smith <john@company.com>" ? "John Smith"
    const match = fromHeader.match(/^([^<]+)</)
    return match ? match[1].trim() : fromHeader.split('@')[0]
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
    }
    if (event.httpMethod === 'OPTIONS') return handleOptions()
    const authErr = requireAuth(event); if (authErr) return authErr

    let payload
    try { payload = JSON.parse(event.body) } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    const { thread_id, from_email, from_name: rawName } = payload

    if (!thread_id || !from_email) {
        return { statusCode: 400, body: JSON.stringify({ error: 'thread_id and from_email required' }) }
    }

    // Guard: if Tavily key is missing, write a neutral placeholder and return standardized error
    if (!TAVILY_API_KEY) {
        console.warn('[research-counterparty] TAVILY_API_KEY not set — writing placeholder intel')
        const err = serviceError('tavily', 'TAVILY_API_KEY not configured — research skipped')
        const placeholder = {
            company_summary: 'Research skipped — TAVILY_API_KEY not configured.',
            financial_health: 'Unknown',
            recent_news: 'Unknown',
            person_summary: 'Unknown',
            leverage_signals: [],
            negotiating_implications: 'Research unavailable. Set TAVILY_API_KEY in Netlify environment variables.',
            researched_at: err.ts,
            service_error: err,           // standardized shape — queryable from dashboard
        }
        await getDB().from('email_threads').update({ counterparty_intel: placeholder }).eq('id', thread_id)
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intel: placeholder, service_error: err }) }
    }

    const domain = extractDomain(from_email)
    const personName = rawName || extractName(from_email)
    const companyName = domain.split('.')[0]

    if (!domain || domain.includes('gmail.com') || domain.includes('yahoo.com') || domain.includes('hotmail.com')) {
        // Personal email — research the person only
        const personResults = await tavilySearch(`${personName} professional background negotiation industry`)
        const intel = {
            company_summary: 'Personal email — no company domain available',
            financial_health: 'Unknown',
            recent_news: 'No company domain found',
            person_summary: personResults,
            leverage_signals: [],
            negotiating_implications: 'Individual negotiator — focus on personal motivations, career stage, risk tolerance',
            researched_at: new Date().toISOString(),
            domain,
        }
        await getDB().from('email_threads').update({ counterparty_intel: intel }).eq('id', thread_id)
        return { statusCode: 200, body: JSON.stringify({ intel }) }
    }

    // Run research queries in parallel
    const [
        companyOverview,
        recentNews,
        financialHealth,
        personProfile,
    ] = await Promise.all([
        tavilySearch(`${companyName} ${domain} company overview employees revenue industry`),
        tavilySearch(`${companyName} ${domain} news 2024 2025 layoffs funding acquisition strategic`),
        tavilySearch(`${companyName} ${domain} financial health funding rounds valuation investors`),
        tavilySearch(`${personName} ${companyName} professional background title role linkedin`),
    ])

    // Synthesize leverage signals from research
    const leverageSignals = []
    const newsLower = recentNews.toLowerCase()
    const financeLower = financialHealth.toLowerCase()

    if (newsLower.includes('layoff') || newsLower.includes('laid off') || newsLower.includes('workforce reduction')) {
        leverageSignals.push('Possible layoffs detected — company under cost pressure, may urgently need deals to show value')
    }
    if (newsLower.includes('cfo') || newsLower.includes('ceo') || newsLower.includes('executive departure')) {
        leverageSignals.push('Executive departure detected — procurement oversight may be disrupted or inconsistent')
    }
    if (financeLower.includes('series a') || financeLower.includes('series b') || financeLower.includes('series c')) {
        const match = financeLower.match(/series ([a-d])/i)
        if (match) {
            leverageSignals.push(`Recently raised Series ${match[1].toUpperCase()} — under investor pressure to show revenue and growth; may prioritize closing deals`)
        }
    }
    if (newsLower.includes('acquisition') || newsLower.includes('merger') || newsLower.includes('acquired')) {
        leverageSignals.push('M&A activity detected — organizational priorities may be in flux; decision authority could be uncertain')
    }
    if (newsLower.includes('regulatory') || newsLower.includes('lawsuit') || newsLower.includes('ftc') || newsLower.includes('doj')) {
        leverageSignals.push('Regulatory or legal pressure detected — timeline urgency may be real; reputational sensitivity elevated')
    }
    if (newsLower.includes('ipo') || newsLower.includes('going public')) {
        leverageSignals.push('IPO preparation detected — compliance, optics, and deal documentation standards are elevated; they want clean deals')
    }

    // Determine negotiating implications
    let negotiatingImplications = 'Standard commercial negotiation posture.'
    if (leverageSignals.length > 0) {
        if (leverageSignals.some(s => s.includes('pressure') || s.includes('urgency'))) {
            negotiatingImplications = 'Counterparty likely under external pressure. Their urgency may be real — exploit timeline without revealing you know. Hold firm on price; they need to show deal activity.'
        } else if (leverageSignals.some(s => s.includes('acquisition'))) {
            negotiatingImplications = 'Organizational change creates uncertainty about decision authority. Confirm the actual decision-maker before making major concessions. Change creates urgency on their side.'
        }
    }

    const intel = {
        company_name: companyName,
        domain,
        company_summary: companyOverview,
        financial_health: financialHealth,
        recent_news: recentNews,
        person_name: personName,
        person_summary: personProfile,
        leverage_signals: leverageSignals,
        negotiating_implications: negotiatingImplications,
        researched_at: new Date().toISOString(),
    }

    // Store in Supabase
    await getDB().from('email_threads').update({ counterparty_intel: intel }).eq('id', thread_id)

    return { statusCode: 200, body: JSON.stringify({ intel }) }
}
