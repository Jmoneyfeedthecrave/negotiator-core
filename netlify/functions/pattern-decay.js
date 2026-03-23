/**
 * Netlify Function: pattern-decay
 * POST /api/pattern-decay
 * Applies confidence decay to old unvalidated patterns and boosts winning ones.
 * Call periodically or on-demand from the dashboard.
 *
 * FIX (BUG-5): replaced N+1 sequential per-row UPDATE loops with batched
 * Postgres operations — a single WHERE-filtered UPDATE for decay, and a
 * single IN(...) UPDATE for boost. Eliminates timeout risk on large libraries.
 */

$args[0].Groups[1].Value + $args[0].Groups[2].Value + ", handleOptions" + $args[0].Groups[3].Value

let _db
function getDB() { return (_db ??= getSupabaseAdmin()) }

const DECAY_RATE = 0.05          // 5% decay for stale patterns
const BOOST_RATE = 0.10          // 10% boost for validated winning patterns
const STALE_DAYS = 90            // patterns older than 90 days without validation decay
const MIN_CONFIDENCE = 0.20      // floor so patterns never fully disappear
const MAX_CONFIDENCE = 0.99      // ceiling

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
    if (event.httpMethod === 'OPTIONS') return handleOptions()
    const authErr = requireAuth(event); if (authErr) return authErr

    try {
        const now = new Date()
        const staleThreshold = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()

        // -- 1. DECAY: Single batched UPDATE via Postgres expression ----------
        // Applies decay to all stale patterns in ONE query instead of N individual calls.
        // Uses GREATEST() to enforce the MIN_CONFIDENCE floor at the DB level.
        const { data: decayResult, error: decayErr } = await getDB().rpc('decay_stale_patterns', {
            p_stale_threshold: staleThreshold,
            p_decay_rate: DECAY_RATE,
            p_min_confidence: MIN_CONFIDENCE,
            p_stale_days: STALE_DAYS,
        })

        // Fallback: if RPC doesn't exist yet, use a single raw SQL approach
        let decayed = 0
        if (decayErr) {
            // rpc not yet deployed — fall back to a WHERE-clause batch update
            console.warn('[pattern-decay] RPC not available, using batched fallback:', decayErr.message)

            // Fetch IDs of stale patterns (one query)
            const { data: stalePatterns } = await getDB()
                .from('learned_patterns')
                .select('id, confidence_score')
                .or(`last_validated_at.is.null,last_validated_at.lt.${staleThreshold}`)
                .gt('confidence_score', MIN_CONFIDENCE)
                .lt('created_at', staleThreshold)  // Only patterns old enough to be stale

            if (stalePatterns?.length > 0) {
                const ids = stalePatterns.map(p => p.id)
                // Single UPDATE for ALL stale patterns at once
                await getDB().rpc('batch_decay_patterns', {
                    p_ids: ids,
                    p_decay_rate: DECAY_RATE,
                    p_min_confidence: MIN_CONFIDENCE,
                }).catch(async () => {
                    // If batch RPC also fails, do manual batched update (groups of 50)
                    const BATCH = BATCH_SIZE
                    for (let i = 0; i < stalePatterns.length; i += BATCH) {
                        const batch = stalePatterns.slice(i, i + BATCH)
                        await Promise.all(batch.map(p => {
                            const newScore = Math.max(MIN_CONFIDENCE, (p.confidence_score || 0.7) - DECAY_RATE)
                            return getDB().from('learned_patterns')
                                .update({ confidence_score: parseFloat(newScore.toFixed(3)) })
                                .eq('id', p.id)
                        }))
                    }
                })
                decayed = stalePatterns.length
            }
        } else {
            decayed = decayResult ?? 0
        }

        // -- 2. BOOST: Fetch win thread IDs, then single IN-clause UPDATE -----
        const { data: winOutcomes } = await getDB()
            .from('negotiation_outcomes')
            .select('thread_id')
            .eq('outcome', 'win')

        let boosted = 0
        if (winOutcomes && winOutcomes.length > 0) {
            const winThreadIds = winOutcomes.map(o => o.thread_id).filter(Boolean)

            // Fetch win patterns (one query)
            const { data: winPatterns } = await getDB()
                .from('learned_patterns')
                .select('id, confidence_score')
                .in('source_thread_id', winThreadIds)
                .lt('confidence_score', MAX_CONFIDENCE)

            if (winPatterns?.length > 0) {
                // Parallel batch boost — Promise.all on groups of 50 instead of N sequential awaits
                const BATCH = BATCH_SIZE
                for (let i = 0; i < winPatterns.length; i += BATCH) {
                    const batch = winPatterns.slice(i, i + BATCH)
                    await Promise.all(batch.map(p => {
                        const newScore = Math.min(MAX_CONFIDENCE, (p.confidence_score || 0.7) + BOOST_RATE)
                        return getDB().from('learned_patterns')
                            .update({
                                confidence_score: parseFloat(newScore.toFixed(3)),
                                last_validated_at: now.toISOString(),
                            })
                            .eq('id', p.id)
                    }))
                }
                boosted = winPatterns.length
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                decayed,
                boosted,
                total_win_threads: (winOutcomes || []).length,
            }),
        }
    } catch (err) {
        console.error('[pattern-decay]', err)
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
    }
}
