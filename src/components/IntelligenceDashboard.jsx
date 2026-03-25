/**
 * IntelligenceDashboard — Dark War Room (v3)
 * Matches the concept: large avatar, always-visible gauges, dense glowing data
 */

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"

const ESCALATION_LABELS = ['—', 'Collaborative', 'Probing', 'Assertive', 'Hard Push', 'Take-Away']
const ESCALATION_COLORS = ['#475569', '#22d3ee', '#34d399', '#fbbf24', '#f97316', '#ef4444']
const ESCALATION_GLOW   = ['transparent', 'rgba(34,211,238,0.5)', 'rgba(52,211,153,0.5)', 'rgba(251,191,36,0.5)', 'rgba(249,115,22,0.5)', 'rgba(239,68,68,0.5)']

/* ── Helpers ────────────────────────────────────────────── */
function initials(str = '') {
    const parts = str.replace(/[^a-z\s]/gi, ' ').trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return str.slice(0, 2).toUpperCase() || '??'
}

function avatarColor(str = '') {
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#3b82f6', '#10b981', '#e11d48']
    let h = 0
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % colors.length
    return colors[Math.abs(h)]
}

function daysSince(thread) {
    if (!thread?.created_at) return 'Today'
    const days = Math.floor((Date.now() - new Date(thread.created_at).getTime()) / 86400000)
    return days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`
}

/* ── Trust Arc Gauge ───────────────────────────────────── */
function TrustArc({ level = 0 }) {
    const pct   = Math.max(0, Math.min(1, level))
    const r     = 34, cx = 44, cy = 44
    const circ  = 2 * Math.PI * r
    const arc   = circ * 0.75
    const dash  = arc * pct
    const offset= circ * 0.375
    const color = pct > 0.65 ? '#34d399' : pct > 0.35 ? '#fbbf24' : '#ef4444'
    const glow  = pct > 0.65 ? 'rgba(52,211,153,0.6)' : pct > 0.35 ? 'rgba(251,191,36,0.6)' : 'rgba(239,68,68,0.6)'
    const label = pct > 0.65 ? 'Strong rapport' : pct > 0.35 ? 'Guarded' : 'Low trust'

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '4px 0' }}>
            <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
                <svg width="88" height="88" style={{ transform: 'rotate(135deg)' }}>
                    <circle cx={cx} cy={cy} r={r} fill="none"
                        stroke="rgba(255,255,255,0.06)" strokeWidth="7"
                        strokeDasharray={`${arc} ${circ - arc}`}
                        strokeDashoffset={-offset} strokeLinecap="round" />
                    <circle cx={cx} cy={cy} r={r} fill="none"
                        stroke={color} strokeWidth="7"
                        strokeDasharray={`${dash || 0.01} ${(arc - dash) + (circ - arc)}`}
                        strokeDashoffset={-offset} strokeLinecap="round"
                        style={{ filter: `drop-shadow(0 0 8px ${glow})`, transition: 'stroke-dasharray 1s ease' }} />
                </svg>
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                    <span style={{ fontSize: '18px', fontWeight: '800', color, lineHeight: 1, fontFamily: FONT }}>
                        {Math.round(pct * 100)}
                    </span>
                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '2px' }}>Trust</span>
                </div>
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color, marginBottom: '4px' }}>{label}</div>
                <div style={{ height: '5px', borderRadius: '99px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '6px' }}>
                    <div style={{
                        height: '100%', borderRadius: '99px',
                        width: `${Math.max(pct * 100, 2)}%`,
                        background: `linear-gradient(90deg, #ef4444 0%, #fbbf24 50%, #34d399 100%)`,
                        boxShadow: `0 0 10px ${glow}`,
                        transition: 'width 1s ease',
                    }} />
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', lineHeight: '1.5' }}>
                    {pct === 0
                        ? 'Awaiting interaction data'
                        : pct > 0.65 ? 'Counter-party is receptive'
                        : pct > 0.35 ? 'Proceed carefully — mixed signals'
                        : 'High friction — use rapport tactics'}
                </div>
            </div>
        </div>
    )
}

/* ── Escalation Bar ────────────────────────────────────── */
function EscalationBar({ level = 1 }) {
    const l = Math.max(1, Math.min(5, level || 1))
    return (
        <div>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                {[1,2,3,4,5].map(i => (
                    <div key={i} style={{
                        flex: 1, height: '8px', borderRadius: '4px',
                        background: i <= l ? ESCALATION_COLORS[l] : 'rgba(255,255,255,0.06)',
                        boxShadow: i <= l ? `0 0 10px ${ESCALATION_GLOW[l]}` : 'none',
                        transition: 'all 0.4s ease',
                    }} />
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: ESCALATION_COLORS[l] }}>
                    {ESCALATION_LABELS[l]}
                </span>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>Level {l} / 5</span>
            </div>
        </div>
    )
}

/* ── Glowing Tag ───────────────────────────────────────── */
function Tag({ label, color = '#6366f1' }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: '10px', fontWeight: '600', fontFamily: FONT,
            padding: '3px 10px', borderRadius: '99px',
            background: `${color}18`,
            border: `1px solid ${color}45`,
            color,
            boxShadow: `0 0 10px ${color}30`,
            margin: '0 4px 4px 0',
        }}>{label}</span>
    )
}

/* ── Section Card ──────────────────────────────────────── */
function Card({ icon, title, accent = '#6366f1', children }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.025)',
            border: `1px solid rgba(255,255,255,0.07)`,
            borderTop: `1px solid ${accent}30`,
            borderRadius: '12px', overflow: 'hidden',
            marginBottom: '6px',
        }}>
            <div style={{
                padding: '9px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', gap: '7px',
                background: `linear-gradient(90deg, ${accent}0f 0%, transparent 100%)`,
            }}>

                <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.09em', textTransform: 'uppercase', color: accent }}>{title}</span>
            </div>
            <div style={{ padding: '12px 14px' }}>{children}</div>
        </div>
    )
}

/* ── Data Row ──────────────────────────────────────────── */
function Row({ label, value, color = 'rgba(255,255,255,0.65)' }) {
    if (!value) return null
    return (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '7px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.22)', minWidth: '76px', paddingTop: '1px', flexShrink: 0, fontWeight: '600', letterSpacing: '0.02em' }}>{label}</span>
            <span style={{ fontSize: '11px', color, flex: 1, lineHeight: '1.55', wordBreak: 'break-word' }}>{value}</span>
        </div>
    )
}

/* ── Callout Box ───────────────────────────────────────── */
function Callout({ text, color = '#34d399', icon = '→' }) {
    return (
        <div style={{
            padding: '9px 12px',
            background: `${color}09`,
            border: `1px solid ${color}25`,
            borderLeft: `3px solid ${color}`,
            borderRadius: '0 8px 8px 0',
            fontSize: '11px', color, lineHeight: '1.6',
            boxShadow: `inset 0 0 30px ${color}05, 0 0 12px ${color}08`,
            marginTop: '8px',
        }}>
            <span style={{ opacity: 0.6, marginRight: '4px', fontSize: '10px' }}>{icon}</span>{text}
        </div>
    )
}

/* ── Main Component ────────────────────────────────────── */
export default function IntelligenceDashboard({ thread }) {
    const panel = {
        width: '420px', minWidth: '420px',
        background: 'linear-gradient(180deg, #0d1117 0%, #0a0f1a 100%)',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
        fontFamily: FONT,
    }

    if (!thread) {
        return (
            <div style={{ ...panel, alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', padding: '32px 20px' }}>

                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.15)', lineHeight: '1.8' }}>
                        Select a negotiation<br />to open the war room
                    </div>
                </div>
            </div>
        )
    }

    const intel   = thread.counterparty_intel   || {}
    const profile = thread.counterparty_profile || {}
    const state   = thread.thread_state         || {}
    const email   = thread.counterparty_email   || ''
    const personName = intel.person_name || ''
    const companyName = intel.company_name || ''
    const displayName = personName || companyName || email.split('@')[0]
    const subline = companyName && personName ? companyName : email
    const bgColor = avatarColor(email)
    const abbr    = initials(personName || email.split('@')[0])
    const trustLevel = profile.trust_level ?? 0
    const escalLevel = state.escalation_level || 1

    return (
        <div style={panel}>

            {/* ── Panel Header ───────────────────────────────── */}
            <div style={{
                padding: '11px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(255,255,255,0.015)',
            }}>

                <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6366f1' }}>Intelligence</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
                    <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', fontWeight: '600' }}>LIVE</span>
                </div>
            </div>

            {/* ── Profile Card ───────────────────────────────── */}
            <div style={{
                margin: '12px 12px 0',
                background: `linear-gradient(135deg, ${bgColor}20 0%, ${bgColor}08 60%, rgba(99,102,241,0.05) 100%)`,
                border: `1px solid ${bgColor}35`,
                borderRadius: '16px',
                padding: '16px',
                boxShadow: `0 0 40px ${bgColor}15`,
            }}>
                {/* Avatar + Identity */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
                    <div style={{
                        width: '56px', height: '56px', borderRadius: '50%',
                        background: `linear-gradient(135deg, ${bgColor} 0%, ${bgColor}88 100%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '18px', fontWeight: '800', color: '#fff', letterSpacing: '-0.5px',
                        boxShadow: `0 0 28px ${bgColor}55, 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)`,
                        flexShrink: 0,
                    }}>{abbr}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            fontSize: '16px', fontWeight: '800', color: '#fff', lineHeight: 1.2,
                            marginBottom: '4px',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{displayName}</div>
                        <div style={{
                            fontSize: '11px', color: 'rgba(255,255,255,0.35)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{subline}</div>
                    </div>
                </div>

                {/* Stat chips */}
                <div style={{ display: 'flex', gap: '6px' }}>
                    {[
                        { v: `Move #${state.move_number || 1}`, c: '#6366f1' },
                        { v: daysSince(thread),                   c: '#14b8a6' },
                        { v: thread.thread_type === 'outbound' ? '↑ Outbound' : '↓ Inbound', c: '#a78bfa' },
                    ].map(({ v, c }) => (
                        <div key={v} style={{
                            flex: 1, textAlign: 'center', padding: '6px 4px',
                            borderRadius: '10px',
                            background: `${c}18`,
                            border: `1px solid ${c}35`,
                            fontSize: '10px', fontWeight: '700', color: c,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            boxShadow: `0 0 12px ${c}20`,
                        }}>{v}</div>
                    ))}
                </div>
            </div>

            {/* ── Sections ───────────────────────────────────── */}
            <div style={{ padding: '10px 12px 24px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

                {/* ── Behavioral Profile ─────────────────────── */}
                <Card title="Behavioral Profile" accent="#a78bfa">
                    {/* Trust gauge — always visible */}
                    <div style={{ marginBottom: '16px' }}>
                        <TrustArc level={trustLevel} />
                    </div>

                    {/* Escalation — always visible */}
                    <div style={{ marginBottom: Object.keys(profile).length > 0 ? '12px' : '0' }}>
                        <div style={{ fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '8px' }}>Escalation Level</div>
                        <EscalationBar level={escalLevel} />
                    </div>

                    {Object.keys(profile).length > 0 && (
                        <>
                            <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '10px 0' }} />
                            <Row label="Style"       value={profile.communication_style} color="#c4b5fd" />
                            <Row label="Personality" value={profile.personality_type}    color="#a5b4fc" />
                            <Row label="Authority"   value={profile.decision_authority}
                                color={profile.decision_authority === 'confirmed_decision_maker' ? '#34d399' : profile.decision_authority === 'gatekeeper' ? '#fbbf24' : 'rgba(255,255,255,0.5)'} />
                            <Row label="Ego Risk"    value={profile.ego_sensitivity}
                                color={profile.ego_sensitivity === 'high' ? '#ef4444' : profile.ego_sensitivity === 'medium' ? '#fbbf24' : '#34d399'} />

                            {profile.detected_pressure_points?.length > 0 && (
                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '6px' }}>Pressure Points</div>
                                    {profile.detected_pressure_points.map((p, i) => <Tag key={i} label={p} color="#fbbf24" />)}
                                </div>
                            )}
                            {profile.tells?.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '6px' }}>Confirmed Tells</div>
                                    {profile.tells.map((t, i) => <Tag key={i} label={t} color="#f87171" />)}
                                </div>
                            )}
                            {profile.bluff_signals_seen?.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '6px' }}>Bluff Signals</div>
                                    {profile.bluff_signals_seen.map((b, i) => <Tag key={i} label={b} color="#a78bfa" />)}
                                </div>
                            )}
                        </>
                    )}
                </Card>

                {/* ── Counterparty Research ──────────────────── */}
                <Card title="Counterparty Research" accent="#38bdf8">
                    {Object.keys(intel).length === 0 ? (
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.18)', lineHeight: '1.7', textAlign: 'center', padding: '8px 0' }}>
                            Research fires automatically<br />on first inbound email
                        </div>
                    ) : (
                        <>
                            {intel.company_summary && (
                                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', lineHeight: '1.6', marginBottom: '10px' }}>
                                    {intel.company_summary.slice(0, 200)}{intel.company_summary.length > 200 ? '…' : ''}
                                </div>
                            )}
                            <Row label="Financials" value={intel.financial_health?.slice(0, 100)} color="rgba(255,255,255,0.45)" />
                            {intel.recent_news && intel.recent_news !== 'None found' && (
                                <Row label="News" value={intel.recent_news?.slice(0, 120)} color="#fbbf24" />
                            )}
                            {intel.person_summary && (
                                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.6', marginTop: '6px', marginBottom: '8px' }}>
                                    {intel.person_summary.slice(0, 150)}{intel.person_summary.length > 150 ? '…' : ''}
                                </div>
                            )}
                            {intel.leverage_signals?.length > 0 && (
                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ fontSize: '9px', fontWeight: '700', color: 'rgba(255,255,255,0.18)', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '6px' }}>Leverage Signals</div>
                                    {intel.leverage_signals.map((s, i) => <Tag key={i} label={s} color="#fbbf24" />)}
                                </div>
                            )}
                            {intel.negotiating_implications && (
                                <Callout text={intel.negotiating_implications} color="#34d399" icon="→" />
                            )}
                        </>
                    )}
                </Card>

                {/* ── Strategic State ────────────────────────── */}
                <Card title="Strategic State" accent="#34d399">
                    {!state.strategic_game_plan && !state.planned_next_move && !state.thread_observations?.length ? (
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.18)', lineHeight: '1.7', textAlign: 'center', padding: '8px 0' }}>
                            Strategy builds after<br />the first exchange
                        </div>
                    ) : (
                        <>
                            {state.strategic_game_plan && (
                                <Callout text={state.strategic_game_plan} color="#34d399" icon="→" />
                            )}
                            {state.planned_next_move && (
                                <div style={{
                                    padding: '8px 12px', marginTop: '8px',
                                    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                                    borderRadius: '8px', fontSize: '11px', color: '#a5b4fc', lineHeight: '1.5',
                                }}>
                                    <strong style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', display: 'block', marginBottom: '2px' }}>NEXT MOVE</strong>
                                    {state.planned_next_move}
                                </div>
                            )}
                            {state.concessions_we_made?.length > 0 && (
                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.18)', fontWeight: '700', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '5px' }}>We Conceded</div>
                                    {state.concessions_we_made.slice(-3).map((c, i) => <div key={i} style={{ fontSize: '10px', color: '#f87171', marginBottom: '2px' }}>↓ {c}</div>)}
                                </div>
                            )}
                            {state.concessions_they_made?.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.18)', fontWeight: '700', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '5px' }}>They Conceded</div>
                                    {state.concessions_they_made.slice(-3).map((c, i) => <div key={i} style={{ fontSize: '10px', color: '#34d399', marginBottom: '2px' }}>↑ {c}</div>)}
                                </div>
                            )}
                            {state.thread_observations?.length > 0 && (
                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.18)', fontWeight: '700', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '6px' }}>Observations</div>
                                    {state.thread_observations.slice(-5).map((obs, i) => (
                                        <div key={i} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', lineHeight: '1.55' }}>· {obs}</div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </Card>

            </div>
        </div>
    )
}
