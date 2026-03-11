import { useState } from 'react'
import { PERSONAS } from '../data/personas.js'

const DOMAINS = [
    'Real Estate Negotiation',
    'Salary & Compensation',
    'Vendor Contract Negotiation',
    'Merger & Acquisition',
    'Software Licensing Deal',
    'Partnership Agreement',
    'Freelance Project Rate',
    'Car Purchase',
    'Contract Negotiation',
    'Political Negotiation',
    'Spouse Negotiation',
]

const OUTCOME_COLORS = {
    won: '#86efac',
    lost: '#f87171',
    batna_breach: '#f97316',
    stalemate: '#fbbf24',
}

export default function SimRunner() {
    const [domain, setDomain] = useState(DOMAINS[0])
    const [personaId, setPersonaId] = useState('random')
    const [sessionCount, setSessionCount] = useState(5)
    const [batnaValue, setBatnaValue] = useState(80)
    const [targetValue, setTargetValue] = useState(100)
    const [openingOffer, setOpeningOffer] = useState(120)
    const [running, setRunning] = useState(false)
    const [results, setResults] = useState([])
    const [progress, setProgress] = useState(0)
    const [log, setLog] = useState([])
    const [analysisRunning, setAnalysisRunning] = useState(false)

    function addLog(msg, color = '#e2e8f0') {
        setLog(prev => [...prev, { id: Date.now() + Math.random(), msg, color }])
    }

    async function runSimulation(index) {
        const res = await fetch('/api/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                domain,
                persona_id: personaId,
                max_turns: 4,
                batna_value: batnaValue,
                target_value: targetValue,
                opening_offer: openingOffer,
            }),
        })
        if (!res.ok) {
            let errMsg = `HTTP ${res.status}`
            try { const j = await res.json(); errMsg = j.error || errMsg } catch { errMsg = res.statusText || errMsg }
            if (res.status === 502 || res.status === 504) errMsg = 'Function timed out — try again'
            throw new Error(errMsg)
        }
        return res.json()
    }

    async function runPostGameAnalysis(sessionId) {
        const res = await fetch('/api/post-game-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
        })
        if (!res.ok) return null
        return res.json()
    }

    async function handleRunBatch() {
        setRunning(true)
        setResults([])
        setLog([])
        setProgress(0)
        addLog(`Starting ${sessionCount} simulation(s) — domain: "${domain}", persona: ${personaId === 'random' ? 'random' : PERSONAS.find(p => p.id === personaId)?.name}`, '#93c5fd')

        const batchResults = []

        for (let i = 0; i < sessionCount; i++) {
            try {
                addLog(`[${i + 1}/${sessionCount}] Running simulation...`, '#94a3b8')
                const result = await runSimulation(i)
                batchResults.push(result)
                addLog(
                    `[${i + 1}/${sessionCount}] vs ${result.persona_name} → ${result.outcome.toUpperCase()} | Final: ${result.final_value ?? 'n/a'} | Score: ${result.win_vs_target !== null ? result.win_vs_target.toFixed(1) + '%' : 'n/a'} | Turns: ${result.turns_taken}`,
                    OUTCOME_COLORS[result.outcome] || '#e2e8f0'
                )
                setResults([...batchResults])
                setProgress(Math.round(((i + 1) / sessionCount) * 100))

                // Run post-game analysis inline
                setAnalysisRunning(true)
                try {
                    const analysis = await runPostGameAnalysis(result.session_id)
                    if (analysis?.analysis?.most_effective_tactic) {
                        addLog(`  ↳ Best tactic: ${analysis.analysis.most_effective_tactic} | ${analysis.analysis.summary}`, '#a5b4fc')
                    }
                } catch { /* analysis failure is non-fatal */ }
                finally { setAnalysisRunning(false) }

            } catch (err) {
                addLog(`[${i + 1}/${sessionCount}] Error: ${err.message}`, '#f87171')
                setProgress(Math.round(((i + 1) / sessionCount) * 100))
            }
        }

        addLog(`Batch complete. ${batchResults.filter(r => r.outcome === 'won').length}/${sessionCount} won.`, '#86efac')
        setRunning(false)
    }

    // Aggregate stats
    const wins = results.filter(r => r.outcome === 'won').length
    const losses = results.filter(r => r.outcome === 'lost').length
    const breachers = results.filter(r => r.outcome === 'batna_breach').length
    const stalemates = results.filter(r => r.outcome === 'stalemate').length
    const winRate = results.length > 0 ? ((wins / results.length) * 100).toFixed(1) : null
    const avgScore = results.length > 0 && results.some(r => r.win_vs_target !== null)
        ? (results.filter(r => r.win_vs_target !== null).reduce((sum, r) => sum + r.win_vs_target, 0) / results.filter(r => r.win_vs_target !== null).length).toFixed(1)
        : null
    const avgTurns = results.length > 0
        ? (results.reduce((sum, r) => sum + r.turns_taken, 0) / results.length).toFixed(1)
        : null
    const hardestPersona = results.length > 1
        ? results.filter(r => r.outcome !== 'won').map(r => r.persona_name).sort((a, b) =>
            results.filter(r2 => r2.persona_name === b && r2.outcome !== 'won').length -
            results.filter(r2 => r2.persona_name === a && r2.outcome !== 'won').length)[0] || null
        : null

    const s = {
        container: { padding: '16px', maxWidth: '960px', margin: '0 auto' },
        h1: { fontSize: '18px', marginBottom: '16px', color: '#94a3b8' },
        grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' },
        label: { color: '#94a3b8', display: 'block', marginBottom: '4px', fontSize: '12px' },
        input: { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', fontFamily: 'monospace', width: '100%' },
        select: { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', fontFamily: 'monospace', width: '100%' },
        btn: { background: running ? '#1e293b' : '#1e40af', border: 'none', color: running ? '#64748b' : '#fff', padding: '8px 20px', cursor: running ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '14px' },
        progressBar: { height: '6px', background: '#1e293b', marginBottom: '16px', borderRadius: '3px' },
        progressFill: { height: '100%', background: '#3b82f6', width: `${progress}%`, transition: 'width 0.3s', borderRadius: '3px' },
        statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' },
        statCard: { background: '#0f172a', border: '1px solid #1e293b', padding: '10px', textAlign: 'center' },
        statValue: { fontSize: '22px', fontWeight: 'bold', marginBottom: '4px' },
        statLabel: { fontSize: '11px', color: '#64748b' },
        log: { background: '#0f172a', border: '1px solid #1e293b', padding: '10px', height: '260px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px' },
        logEntry: { marginBottom: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        resultsTable: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '12px' },
        th: { background: '#0f172a', padding: '6px 10px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1e293b' },
        td: { padding: '5px 10px', borderBottom: '1px solid #0f172a', fontFamily: 'monospace' },
        divider: { borderTop: '1px solid #1e293b', margin: '14px 0' },
    }

    return (
        <div style={s.container}>
            <h1 style={s.h1}>🎯 SIMULATION RUNNER — PHASE 2</h1>

            {/* Config */}
            <div style={s.grid}>
                <div>
                    <label style={s.label}>Domain</label>
                    <select style={s.select} value={domain} onChange={e => setDomain(e.target.value)} disabled={running}>
                        {DOMAINS.map(d => <option key={d}>{d}</option>)}
                    </select>
                </div>
                <div>
                    <label style={s.label}>Counterparty Persona</label>
                    <select style={s.select} value={personaId} onChange={e => setPersonaId(e.target.value)} disabled={running}>
                        <option value="random">🎲 Random (each session)</option>
                        {PERSONAS.map(p => <option key={p.id} value={p.id}>{p.name} — {p.description.substring(0, 50)}...</option>)}
                    </select>
                </div>
                <div>
                    <label style={s.label}>Sessions to Run</label>
                    <input style={s.input} type="number" min={1} max={20} value={sessionCount} onChange={e => setSessionCount(Number(e.target.value))} disabled={running} />
                </div>
                <div>
                    <label style={s.label}>BATNA Value (walk-away floor)</label>
                    <input style={s.input} type="number" value={batnaValue} onChange={e => setBatnaValue(Number(e.target.value))} disabled={running} />
                </div>
                <div>
                    <label style={s.label}>Target Value (our goal)</label>
                    <input style={s.input} type="number" value={targetValue} onChange={e => setTargetValue(Number(e.target.value))} disabled={running} />
                </div>
                <div>
                    <label style={s.label}>Opening Offer (our first offer)</label>
                    <input style={s.input} type="number" value={openingOffer} onChange={e => setOpeningOffer(Number(e.target.value))} disabled={running} />
                </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
                <button style={s.btn} onClick={handleRunBatch} disabled={running}>
                    {running ? `⟳ Running... ${progress}% (${results.length}/${sessionCount} done)${analysisRunning ? ' [Analyzing...]' : ''}` : '▶  Run Simulation Batch'}
                </button>
            </div>

            {/* Progress bar */}
            {(running || progress > 0) && (
                <div style={s.progressBar}><div style={s.progressFill} /></div>
            )}

            {/* Stats */}
            {results.length > 0 && (
                <>
                    <div style={s.statsGrid}>
                        <div style={s.statCard}>
                            <div style={{ ...s.statValue, color: '#86efac' }}>{winRate}%</div>
                            <div style={s.statLabel}>Win Rate</div>
                        </div>
                        <div style={s.statCard}>
                            <div style={{ ...s.statValue, color: '#93c5fd' }}>{avgScore !== null ? avgScore + '%' : '—'}</div>
                            <div style={s.statLabel}>Avg Score vs Target</div>
                        </div>
                        <div style={s.statCard}>
                            <div style={{ ...s.statValue, color: '#e2e8f0' }}>{avgTurns}</div>
                            <div style={s.statLabel}>Avg Turns to Close</div>
                        </div>
                        <div style={s.statCard}>
                            <div style={{ ...s.statValue, color: '#f87171', fontSize: '14px' }}>{hardestPersona || '—'}</div>
                            <div style={s.statLabel}>Hardest Opponent</div>
                        </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                        {wins}W / {losses}L / {breachers} BATNA / {stalemates} stalemate  |  {results.length} sessions
                    </div>
                </>
            )}

            {/* Log */}
            <div style={s.divider} />
            <div style={{ color: '#64748b', marginBottom: '4px', fontSize: '12px' }}>Simulation Log:</div>
            <div style={s.log}>
                {log.length === 0 && <div style={{ color: '#374151' }}>Configure a batch and click Run to begin.</div>}
                {log.map(entry => (
                    <div key={entry.id} style={{ ...s.logEntry, color: entry.color }}>{entry.msg}</div>
                ))}
            </div>

            {/* Results Table */}
            {results.length > 0 && (
                <>
                    <div style={s.divider} />
                    <div style={{ color: '#64748b', marginBottom: '4px', fontSize: '12px' }}>Session Results:</div>
                    <table style={s.resultsTable}>
                        <thead>
                            <tr>
                                <th style={s.th}>#</th>
                                <th style={s.th}>Persona</th>
                                <th style={s.th}>Outcome</th>
                                <th style={s.th}>Final Value</th>
                                <th style={s.th}>Score vs Target</th>
                                <th style={s.th}>Turns</th>
                                <th style={s.th}>Session ID</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((r, i) => (
                                <tr key={r.session_id}>
                                    <td style={s.td}>{i + 1}</td>
                                    <td style={s.td}>{r.persona_name}</td>
                                    <td style={{ ...s.td, color: OUTCOME_COLORS[r.outcome] || '#e2e8f0', fontWeight: 'bold' }}>{r.outcome.toUpperCase()}</td>
                                    <td style={s.td}>{r.final_value ?? '—'}</td>
                                    <td style={{ ...s.td, color: r.win_vs_target !== null ? (r.win_vs_target >= 50 ? '#86efac' : '#f87171') : '#64748b' }}>
                                        {r.win_vs_target !== null ? r.win_vs_target.toFixed(1) + '%' : '—'}
                                    </td>
                                    <td style={s.td}>{r.turns_taken}</td>
                                    <td style={{ ...s.td, color: '#475569' }}>{r.session_id?.substring(0, 8)}...</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    )
}
