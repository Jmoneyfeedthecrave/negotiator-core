import { useState, useRef, useEffect } from 'react'
import { initSession, runNegotiationTurn, endSession } from '../api/claudeClient.js'

/**
 * Sparring Arena — drop-in replacement for TestHarness.jsx
 * Same imports, same default export, same claudeClient wiring.
 *
 * Renders the negotiation as a table: chat transcript with coach cards on the
 * left, live deal state (offer convergence, concession chips, bluff tells) on
 * the right. "Deal Table" design language: felt green, ledger ivory, brass.
 */

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
    feltDeep: '#0E261D',
    felt: '#13301F',
    feltRaised: '#1A3B28',
    line: 'rgba(201,162,39,0.16)',
    ivory: '#F1EBDD',
    ivoryDim: 'rgba(241,235,221,0.62)',
    ivoryFaint: 'rgba(241,235,221,0.38)',
    brass: '#C9A227',
    brassBright: '#E3BD45',
    signal: '#C75146',
    calm: '#7FA88F',
    fontDisplay: '"Fraunces", Georgia, serif',
    fontUi: '"Schibsted Grotesk", "Inter", sans-serif',
    fontMono: '"IBM Plex Mono", "JetBrains Mono", monospace',
}

const FONTS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Schibsted+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
.arena-turns::-webkit-scrollbar, .arena-rail::-webkit-scrollbar { width: 5px; }
.arena-turns::-webkit-scrollbar-thumb, .arena-rail::-webkit-scrollbar-thumb { background: rgba(201,162,39,0.25); border-radius: 99px; }
@keyframes arenaPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
@keyframes arenaThink { 0%,100%{opacity:.25; transform:translateY(0)} 50%{opacity:1; transform:translateY(-3px)} }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
.arena-coach summary::-webkit-details-marker { display: none; }
.arena-coach summary { list-style: none; }
`

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Best-effort: pull a dollar figure out of free text ("$450,000", "495,000", "450k"). */
function parseOffer(text) {
    if (!text) return null
    const candidates = []
    const re = /\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,9}|\d{2,3}(?:\.\d+)?\s*[kK])\b/g
    let m
    while ((m = re.exec(text)) !== null) {
        let raw = m[1].replace(/,/g, '').trim()
        let v
        if (/[kK]$/.test(raw)) v = parseFloat(raw) * 1000
        else v = parseFloat(raw)
        if (Number.isFinite(v) && v >= 1000) candidates.push(v)
    }
    // People usually state their actual offer last.
    return candidates.length ? candidates[candidates.length - 1] : null
}

const fmt = (v) =>
    v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US')

const fmtShort = (v) => {
    if (v == null) return '—'
    if (Math.abs(v) >= 1000) return '$' + Math.round(v / 1000) + 'k'
    return '$' + Math.round(v)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConvergenceTrack({ ourOffers, theirOffers, batna }) {
    const ourCurrent = ourOffers[ourOffers.length - 1] ?? null
    const theirCurrent = theirOffers[theirOffers.length - 1] ?? null
    const ourOpening = ourOffers[0] ?? null
    const theirOpening = theirOffers[0] ?? null

    const vals = [ourCurrent, theirCurrent, ourOpening, theirOpening, batna].filter(
        (v) => typeof v === 'number'
    )
    if (vals.length < 2) {
        return (
            <p style={{ fontSize: 12, color: T.ivoryFaint, lineHeight: 1.5 }}>
                The track draws once both sides have a number on the table.
            </p>
        )
    }
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const pad = Math.max((hi - lo) * 0.08, 1)
    const pos = (v) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100

    const initialGap =
        ourOpening != null && theirOpening != null ? Math.abs(ourOpening - theirOpening) : null
    const currentGap =
        ourCurrent != null && theirCurrent != null ? Math.abs(ourCurrent - theirCurrent) : null
    const closedPct =
        initialGap && currentGap != null && initialGap > 0
            ? Math.round((1 - currentGap / initialGap) * 100)
            : null

    const fillLeft = Math.min(pos(theirCurrent ?? theirOpening), pos(ourCurrent ?? ourOpening))
    const fillRight = Math.max(pos(theirCurrent ?? theirOpening), pos(ourCurrent ?? ourOpening))

    return (
        <div>
            <div style={{ position: 'relative', padding: '30px 6px 42px' }}>
                {theirCurrent != null && (
                    <span style={{ position: 'absolute', top: 2, left: `${pos(theirCurrent)}%`, transform: 'translateX(-50%)', fontFamily: T.fontMono, fontSize: 11, color: T.calm, whiteSpace: 'nowrap' }}>
                        {fmtShort(theirCurrent)}
                    </span>
                )}
                {ourCurrent != null && (
                    <span style={{ position: 'absolute', top: 2, left: `${pos(ourCurrent)}%`, transform: 'translateX(-50%)', fontFamily: T.fontMono, fontSize: 11, color: T.brassBright, whiteSpace: 'nowrap' }}>
                        {fmtShort(ourCurrent)}
                    </span>
                )}
                <div style={{ position: 'relative', height: 3, background: 'rgba(241,235,221,0.12)', borderRadius: 99, marginTop: 24 }}>
                    <div style={{ position: 'absolute', left: `${fillLeft}%`, width: `${Math.max(fillRight - fillLeft, 0)}%`, top: 0, bottom: 0, background: 'linear-gradient(90deg, rgba(127,168,143,0.5), rgba(201,162,39,0.55))', borderRadius: 99 }} />
                    {typeof batna === 'number' && batna > 0 && (
                        <div style={{ position: 'absolute', left: `${pos(batna)}%`, top: -12, bottom: -12, width: 2, background: T.brass, opacity: 0.85 }} />
                    )}
                    {theirCurrent != null && (
                        <span title={`Their offer ${fmt(theirCurrent)}`} style={{ position: 'absolute', left: `${pos(theirCurrent)}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 28, height: 28, borderRadius: '50%', background: '#2B4A3A', border: '2px dashed rgba(127,168,143,0.8)', color: '#CFE3D6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.fontMono, fontSize: 8, boxShadow: '0 3px 10px rgba(0,0,0,0.45)' }}>
                            THEM
                        </span>
                    )}
                    {ourCurrent != null && (
                        <span title={`Our offer ${fmt(ourCurrent)}`} style={{ position: 'absolute', left: `${pos(ourCurrent)}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 28, height: 28, borderRadius: '50%', background: '#3D3214', border: `2px solid ${T.brass}`, color: T.brassBright, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.fontMono, fontSize: 8, boxShadow: '0 3px 10px rgba(0,0,0,0.45)' }}>
                            US
                        </span>
                    )}
                </div>
                {theirOpening != null && (
                    <span style={{ position: 'absolute', bottom: 16, left: `${pos(theirOpening)}%`, transform: 'translateX(-50%)', fontSize: 10, color: T.ivoryFaint, whiteSpace: 'nowrap' }}>
                        opened {fmtShort(theirOpening)}
                    </span>
                )}
                {typeof batna === 'number' && batna > 0 && (
                    <span style={{ position: 'absolute', bottom: 0, left: `${pos(batna)}%`, transform: 'translateX(-50%)', fontFamily: T.fontMono, fontSize: 10, color: T.brass, whiteSpace: 'nowrap' }}>
                        ▲ floor {fmtShort(batna)}
                    </span>
                )}
            </div>
            {currentGap != null && (
                <p style={{ fontSize: 12, color: T.ivoryDim, textAlign: 'center' }}>
                    Gap <b style={{ fontFamily: T.fontMono, color: T.ivory, fontWeight: 500 }}>{fmt(currentGap)}</b>
                    {closedPct != null && closedPct >= 0 && (
                        <> · closed <b style={{ fontFamily: T.fontMono, color: T.ivory, fontWeight: 500 }}>{closedPct}%</b></>
                    )}
                </p>
            )}
        </div>
    )
}

function BudgetChips({ remaining, budget }) {
    const total = budget > 0 ? budget : 20
    const rem = typeof remaining === 'number' ? Math.max(0, remaining) : total
    const chips = 10
    const filled = Math.round((rem / total) * chips)
    return (
        <div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                {Array.from({ length: chips }).map((_, i) => (
                    <span
                        key={i}
                        style={{
                            flex: 1, height: 24, borderRadius: 6,
                            background: i < filled ? 'rgba(201,162,39,0.55)' : 'rgba(241,235,221,0.06)',
                            border: `1px solid ${i < filled ? 'rgba(201,162,39,0.7)' : 'rgba(241,235,221,0.12)'}`,
                            boxShadow: i < filled ? 'inset 0 1px 0 rgba(255,255,255,0.2)' : 'none',
                            transition: 'all .3s ease',
                        }}
                    />
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: T.ivoryDim }}>
                <span>Concession budget</span>
                <b style={{ fontFamily: T.fontMono, color: T.brassBright, fontWeight: 500 }}>
                    {rem.toFixed(1)}% / {total}% left
                </b>
            </div>
        </div>
    )
}

function TellCard({ bluff }) {
    const p = Math.round((bluff.probability ?? 0) * 100)
    const confirmed = p >= 85
    return (
        <div style={{ padding: '11px 13px', border: `1px solid ${T.line}`, borderRadius: 11, background: confirmed ? 'rgba(199,81,70,0.10)' : 'rgba(199,81,70,0.05)', marginBottom: 9 }}>
            <div style={{ fontSize: 12.5, color: T.ivory, lineHeight: 1.45, marginBottom: 8 }}>
                "{bluff.claim}"
                {confirmed && (
                    <span style={{ marginLeft: 7, fontSize: 9, letterSpacing: '0.1em', color: T.signal, border: '1px solid rgba(199,81,70,0.4)', borderRadius: 99, padding: '2px 7px', verticalAlign: 'middle' }}>
                        LIKELY BLUFF
                    </span>
                )}
            </div>
            <div style={{ height: 4, borderRadius: 99, background: 'rgba(241,235,221,0.1)', overflow: 'hidden', marginBottom: 7 }}>
                <i style={{ display: 'block', height: '100%', width: `${p}%`, background: T.signal, borderRadius: 99, transition: 'width .4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10.5, color: T.ivoryFaint }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bluff.evidence_for || ''}>
                    {bluff.evidence_for || 'Assessing'}
                </span>
                <b style={{ fontFamily: T.fontMono, color: T.signal, fontWeight: 500, flexShrink: 0 }}>{p}%</b>
            </div>
        </div>
    )
}

function CoachCard({ coach }) {
    return (
        <details className="arena-coach" style={{ width: '100%', border: `1px solid ${T.line}`, borderRadius: 12, background: 'rgba(201,162,39,0.05)' }}>
            <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', fontSize: 11.5, color: T.ivoryDim, userSelect: 'none' }}>
                <span style={{ fontFamily: T.fontMono, fontSize: 10, letterSpacing: '0.1em', color: T.brass }}>COACH</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{coach.move || 'Turn analysis'}</span>
                <span style={{ marginLeft: 'auto', color: T.ivoryFaint }}>›</span>
            </summary>
            <div style={{ padding: '4px 16px 14px', display: 'grid', gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                <Row label="They used"><b style={{ color: T.ivory, fontWeight: 500 }}>{coach.detected || '—'}</b>{coach.detectedWhy ? ` — ${coach.detectedWhy}` : ''}</Row>
                <Row label="You countered"><b style={{ color: T.ivory, fontWeight: 500 }}>{coach.applied || '—'}</b></Row>
                {coach.appliedWhy && <Row label="Why">{coach.appliedWhy}</Row>}
                {typeof coach.confidence === 'number' && (
                    <Row label="Confidence"><span style={{ fontFamily: T.fontMono, color: T.brassBright }}>{coach.confidence.toFixed(2)}</span></Row>
                )}
                {(coach.reasoning || coach.bayesian) && (
                    <details style={{ marginTop: 2 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11, color: T.ivoryFaint }}>Full reasoning</summary>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: T.ivoryDim, marginTop: 8, fontFamily: T.fontMono, lineHeight: 1.55 }}>
                            {coach.reasoning}
                            {coach.bayesian ? `\n\nBELIEF UPDATE:\n${coach.bayesian}` : ''}
                        </div>
                    </details>
                )}
            </div>
        </details>
    )
}

function Row({ label, children }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '104px 1fr', gap: 10 }}>
            <span style={{ color: T.ivoryFaint, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 1 }}>{label}</span>
            <span style={{ color: T.ivoryDim }}>{children}</span>
        </div>
    )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TestHarness() {
    const [sessionId, setSessionId] = useState(null)
    const [domain, setDomain] = useState('Real Estate Negotiation')
    const [batnaValue, setBatnaValue] = useState(500000)
    const [batnaDesc, setBatnaDesc] = useState('Minimum acceptable sale price')
    const [concessionBudget, setConcessionBudget] = useState(20)
    const [mode, setMode] = useState('coached')
    const [message, setMessage] = useState('')
    const [turns, setTurns] = useState([]) // {kind:'them'|'us'|'breach'|'system', ...}
    const [loading, setLoading] = useState(false)
    const [statusMsg, setStatusMsg] = useState('')
    const [elapsed, setElapsed] = useState(0)
    const [bluffs, setBluffs] = useState([]) // accumulated, replaced by claim
    const [ourOffers, setOurOffers] = useState([])
    const [theirOffers, setTheirOffers] = useState([])
    const [concessionRemaining, setConcessionRemaining] = useState(null)
    const [turnCount, setTurnCount] = useState(0)
    const turnsRef = useRef(null)

    useEffect(() => {
        if (!loading) { setElapsed(0); return }
        const t0 = Date.now()
        const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
        return () => clearInterval(iv)
    }, [loading])

    useEffect(() => {
        turnsRef.current?.scrollTo({ top: turnsRef.current.scrollHeight, behavior: 'smooth' })
    }, [turns, loading])

    function pushTurn(t) {
        setTurns((prev) => [...prev, { id: Date.now() + Math.random(), ...t }])
    }

    async function handleInitSession() {
        setLoading(true)
        setStatusMsg('Opening the table…')
        try {
            const result = await initSession({
                domain,
                configId: null,
                batnaValue,
                batnaDescription: batnaDesc,
                maxTurns: 10,
            })
            setSessionId(result.session_id)
            setTurns([])
            setBluffs([])
            setOurOffers([])
            setTheirOffers([])
            setConcessionRemaining(null)
            setTurnCount(0)
            pushTurn({ kind: 'system', text: `Session open — ${domain}. Floor ${fmt(result.batna_value || batnaValue)}.` })
        } catch (err) {
            pushTurn({ kind: 'system', error: true, text: err.message })
        } finally {
            setLoading(false)
            setStatusMsg('')
        }
    }

    async function handleSendTurn() {
        if (!sessionId || !message.trim() || loading) return
        const theirText = message.trim()
        const theirOffer = parseOffer(theirText)
        pushTurn({ kind: 'them', text: theirText, offer: theirOffer })
        if (theirOffer != null) setTheirOffers((p) => [...p, theirOffer])
        setMessage('')
        setLoading(true)
        setStatusMsg('Reading the table…')
        try {
            const result = await runNegotiationTurn({
                sessionId,
                counterpartyMessage: theirText,
                mode,
                onStatus: (m) => setStatusMsg(m || 'Reading the table…'),
            })

            if (result.type === 'batna_breach') {
                pushTurn({ kind: 'breach', reason: result.reason, withheld: result.withheld_draft })
                return
            }

            const ourOffer = result.updated_offer?.value
            if (typeof ourOffer === 'number') setOurOffers((p) => [...p, ourOffer])
            if (typeof result.concession_remaining === 'number') setConcessionRemaining(result.concession_remaining)
            if (typeof result.turn_number === 'number') setTurnCount(result.turn_number)
            if (result.bluff_probability_updates?.length) {
                setBluffs((prev) => {
                    const map = new Map(prev.map((b) => [b.claim, b]))
                    for (const b of result.bluff_probability_updates) map.set(b.claim, b)
                    return Array.from(map.values())
                })
            }

            pushTurn({
                kind: 'us',
                text: result.natural_language_response,
                offer: typeof ourOffer === 'number' ? ourOffer : null,
                pending: mode === 'coached',
                coach: {
                    detected: result.technique_detected,
                    detectedWhy: result.technique_detected_reasoning,
                    applied: result.technique_applied,
                    appliedWhy: result.technique_applied_reasoning,
                    move: result.move,
                    confidence: result.confidence_score,
                    reasoning: result.internal_reasoning,
                    bayesian: result.bayesian_update_notes,
                },
            })
        } catch (err) {
            pushTurn({ kind: 'system', error: true, text: err.message })
        } finally {
            setLoading(false)
            setStatusMsg('')
        }
    }

    function handleApprove(id) {
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, pending: false, approved: true } : t)))
    }

    async function handleEndSession() {
        if (!sessionId || loading) return
        setLoading(true)
        try {
            await endSession({ sessionId, outcome: 'manual_end', finalValue: ourOffers[ourOffers.length - 1] ?? null })
            const gapLine =
                ourOffers.length && theirOffers.length
                    ? ` Final positions: us ${fmt(ourOffers[ourOffers.length - 1])}, them ${fmt(theirOffers[theirOffers.length - 1])}.`
                    : ''
            pushTurn({ kind: 'system', text: `Session closed after ${turnCount} turn${turnCount === 1 ? '' : 's'}.${gapLine}` })
            setSessionId(null)
        } catch (err) {
            pushTurn({ kind: 'system', error: true, text: err.message })
        } finally {
            setLoading(false)
        }
    }

    const inSession = !!sessionId

    // ── styles ──
    const input = {
        background: T.feltRaised, border: `1px solid ${T.line}`, borderRadius: 10,
        color: T.ivory, padding: '9px 13px', fontFamily: T.fontUi, fontSize: 13.5, outline: 'none',
    }
    const btn = (variant) => ({
        fontFamily: T.fontUi, fontSize: 12.5, fontWeight: variant === 'primary' ? 600 : 500,
        cursor: 'pointer', padding: '8px 16px', borderRadius: 8,
        border: `1px solid ${variant === 'primary' ? T.brass : T.line}`,
        background: variant === 'primary' ? T.brass : 'transparent',
        color: variant === 'primary' ? '#1B1503' : T.ivoryDim,
        opacity: 1,
    })
    const railH3 = { fontFamily: T.fontDisplay, fontWeight: 500, fontSize: 15, color: T.ivory, marginBottom: 13 }
    const railSmall = { fontFamily: T.fontUi, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.ivoryFaint, display: 'block', marginBottom: 3 }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: `radial-gradient(120% 90% at 50% -10%, #16382A 0%, ${T.feltDeep} 55%, #0A1D15 100%)`, color: T.ivory, fontFamily: T.fontUi, fontSize: 14 }}>
            <style>{FONTS_CSS}</style>

            {/* ── Header strip ── */}
            <header style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '11px 22px', borderBottom: `1px solid ${T.line}`, flexShrink: 0, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: T.fontDisplay, fontWeight: 600, fontSize: 18 }}>
                    Sparring<span style={{ color: T.brass }}>·</span>Arena
                </span>
                {inSession && (
                    <span style={{ display: 'flex', gap: 16, fontSize: 12, color: T.ivoryDim, flexWrap: 'wrap' }}>
                        <span>{domain}</span>
                        <span>Floor <b style={{ fontFamily: T.fontMono, color: T.ivory, fontWeight: 500 }}>{fmt(batnaValue)}</b></span>
                        <span>Turn <b style={{ fontFamily: T.fontMono, color: T.ivory, fontWeight: 500 }}>{turnCount}</b></span>
                    </span>
                )}
                <span style={{ flex: 1 }} />
                {inSession && (
                    <>
                        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ ...input, padding: '6px 10px', fontSize: 12 }} aria-label="Mode">
                            <option value="coached">Coached — you approve each send</option>
                            <option value="autonomous">Autonomous — sends directly</option>
                        </select>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: T.ivoryDim }}>
                            <i style={{ width: 7, height: 7, borderRadius: '50%', background: T.brass, display: 'inline-block', animation: 'arenaPulse 2.4s ease infinite' }} />
                            Session live
                        </span>
                        <button style={btn()} onClick={handleEndSession} disabled={loading}>End &amp; review</button>
                    </>
                )}
            </header>

            {/* ── Setup (pre-session) ── */}
            {!inSession && (
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <div style={{ width: 'min(520px, 100%)', background: T.felt, border: `1px solid ${T.line}`, borderRadius: 18, padding: '30px 32px' }}>
                        <h2 style={{ fontFamily: T.fontDisplay, fontWeight: 600, fontSize: 24, marginBottom: 6 }}>Take a seat</h2>
                        <p style={{ fontSize: 13, color: T.ivoryDim, marginBottom: 24, lineHeight: 1.55 }}>
                            You play the counterparty. The negotiator plays your side — and shows its work after every move.
                        </p>
                        <div style={{ display: 'grid', gap: 14 }}>
                            <label style={{ display: 'grid', gap: 6, fontSize: 11.5, color: T.ivoryDim }}>
                                What's being negotiated
                                <input style={input} value={domain} onChange={(e) => setDomain(e.target.value)} />
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
                                <label style={{ display: 'grid', gap: 6, fontSize: 11.5, color: T.ivoryDim }}>
                                    Your floor ($)
                                    <input style={{ ...input, fontFamily: T.fontMono }} type="number" value={batnaValue} onChange={(e) => setBatnaValue(Number(e.target.value))} />
                                </label>
                                <label style={{ display: 'grid', gap: 6, fontSize: 11.5, color: T.ivoryDim }}>
                                    What the floor means
                                    <input style={input} value={batnaDesc} onChange={(e) => setBatnaDesc(e.target.value)} />
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
                                <label style={{ display: 'grid', gap: 6, fontSize: 11.5, color: T.ivoryDim }}>
                                    Concession budget (%)
                                    <input style={{ ...input, fontFamily: T.fontMono }} type="number" min="1" max="100" value={concessionBudget} onChange={(e) => setConcessionBudget(Number(e.target.value))} />
                                </label>
                                <label style={{ display: 'grid', gap: 6, fontSize: 11.5, color: T.ivoryDim }}>
                                    Mode
                                    <select style={input} value={mode} onChange={(e) => setMode(e.target.value)}>
                                        <option value="coached">Coached — you approve each send</option>
                                        <option value="autonomous">Autonomous — sends directly</option>
                                    </select>
                                </label>
                            </div>
                            <button style={{ ...btn('primary'), padding: '11px 20px', fontSize: 13.5, marginTop: 6, opacity: loading ? 0.6 : 1 }} onClick={handleInitSession} disabled={loading}>
                                {loading ? 'Opening the table…' : 'Open the table'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Arena ── */}
            {inSession && (
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', minHeight: 0 }}>
                    {/* transcript */}
                    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: `1px solid ${T.line}` }}>
                        <div ref={turnsRef} className="arena-turns" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                            {turns.length === 0 && (
                                <p style={{ color: T.ivoryFaint, fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 1.6 }}>
                                    The table is open. Type the counterparty's opening move below —<br />an offer, a demand, an ultimatum. See what comes back.
                                </p>
                            )}
                            {turns.map((t) => {
                                if (t.kind === 'system') {
                                    return (
                                        <p key={t.id} style={{ alignSelf: 'center', fontSize: 11.5, color: t.error ? T.signal : T.ivoryFaint, textAlign: 'center', maxWidth: '80%' }}>
                                            {t.text}
                                        </p>
                                    )
                                }
                                if (t.kind === 'breach') {
                                    return (
                                        <div key={t.id} style={{ alignSelf: 'flex-end', maxWidth: '74%', border: `1px solid rgba(199,81,70,0.5)`, background: 'rgba(199,81,70,0.08)', borderRadius: 14, padding: '13px 16px' }}>
                                            <div style={{ fontFamily: T.fontMono, fontSize: 10, letterSpacing: '0.1em', color: T.signal, marginBottom: 7 }}>FLOOR PROTECTED — DRAFT WITHHELD</div>
                                            <div style={{ fontSize: 12.5, color: T.ivoryDim, lineHeight: 1.5 }}>{t.reason}</div>
                                            {t.withheld && (
                                                <details style={{ marginTop: 8 }}>
                                                    <summary style={{ cursor: 'pointer', fontSize: 11, color: T.ivoryFaint }}>Show the withheld draft</summary>
                                                    <div style={{ fontSize: 12.5, color: T.ivoryDim, marginTop: 6, lineHeight: 1.5 }}>{t.withheld}</div>
                                                </details>
                                            )}
                                        </div>
                                    )
                                }
                                const them = t.kind === 'them'
                                return (
                                    <div key={t.id} style={{ maxWidth: '74%', display: 'flex', flexDirection: 'column', gap: 8, alignSelf: them ? 'flex-start' : 'flex-end', alignItems: them ? 'flex-start' : 'flex-end' }}>
                                        <span style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: them ? T.calm : T.brass }}>
                                            {them ? 'Counterparty' : 'Your negotiator'}
                                        </span>
                                        <div style={{ padding: '12px 16px', borderRadius: 14, lineHeight: 1.55, fontSize: 13.5, background: them ? 'rgba(127,168,143,0.10)' : T.feltRaised, border: `1px solid ${them ? 'rgba(127,168,143,0.18)' : T.line}`, [them ? 'borderTopLeftRadius' : 'borderTopRightRadius']: 4 }}>
                                            {t.text}
                                        </div>
                                        {t.offer != null && (
                                            <span style={{ fontFamily: T.fontMono, fontSize: 11.5, color: them ? T.calm : T.brassBright, background: them ? 'rgba(127,168,143,0.10)' : 'rgba(201,162,39,0.10)', border: `1px solid ${them ? 'rgba(127,168,143,0.2)' : T.line}`, padding: '3px 9px', borderRadius: 99 }}>
                                                {them ? 'their offer' : 'our offer'} · {fmt(t.offer)}
                                            </span>
                                        )}
                                        {t.pending && (
                                            <button style={btn('primary')} onClick={() => handleApprove(t.id)}>Approve &amp; send</button>
                                        )}
                                        {t.approved && (
                                            <span style={{ fontSize: 10.5, color: T.ivoryFaint }}>✓ Approved &amp; sent</span>
                                        )}
                                        {t.coach && <CoachCard coach={t.coach} />}
                                    </div>
                                )
                            })}
                            {loading && (
                                <div style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', border: '1px dashed rgba(201,162,39,0.35)', borderRadius: 14, borderTopRightRadius: 4, fontSize: 12.5, color: T.ivoryDim }}>
                                    <span>
                                        <i style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: T.brass, marginRight: 4, animation: 'arenaThink 1.2s ease infinite' }} />
                                        <i style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: T.brass, marginRight: 4, animation: 'arenaThink 1.2s ease .2s infinite' }} />
                                        <i style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: T.brass, animation: 'arenaThink 1.2s ease .4s infinite' }} />
                                    </span>
                                    {statusMsg || 'Reading the table…'}
                                    <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.ivoryFaint }}>
                                        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div style={{ flexShrink: 0, padding: '14px 28px 18px', borderTop: `1px solid ${T.line}`, display: 'flex', gap: 10 }}>
                            <textarea
                                style={{ ...input, flex: 1, resize: 'none', height: 52, lineHeight: 1.4 }}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Type the counterparty's move… (Ctrl+Enter to play)"
                                aria-label="Counterparty message"
                                disabled={loading}
                                onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleSendTurn() }}
                            />
                            <button style={{ ...btn('primary'), opacity: loading || !message.trim() ? 0.5 : 1 }} onClick={handleSendTurn} disabled={loading || !message.trim()}>
                                Play turn
                            </button>
                        </div>
                    </section>

                    {/* table rail */}
                    <aside className="arena-rail" style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 26 }}>
                        <div>
                            <h3 style={railH3}><small style={railSmall}>The table</small>Offer convergence</h3>
                            <ConvergenceTrack ourOffers={ourOffers} theirOffers={theirOffers} batna={batnaValue} />
                        </div>
                        <div>
                            <h3 style={railH3}><small style={railSmall}>Chips</small>What you can still give</h3>
                            <BudgetChips remaining={concessionRemaining} budget={concessionBudget} />
                        </div>
                        <div>
                            <h3 style={railH3}><small style={railSmall}>Reads</small>Tells &amp; bluffs</h3>
                            {bluffs.length === 0 && (
                                <p style={{ fontSize: 12, color: T.ivoryFaint, lineHeight: 1.5 }}>
                                    Their claims get probability-scored here as the negotiator reads them.
                                </p>
                            )}
                            {bluffs.map((b) => <TellCard key={b.claim} bluff={b} />)}
                        </div>
                    </aside>
                </div>
            )}
        </div>
    )
}
