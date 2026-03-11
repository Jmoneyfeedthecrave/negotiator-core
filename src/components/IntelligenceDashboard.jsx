/**
 * IntelligenceDashboard
 * Right-hand panel — macOS liquid glass styled, light frosted surfaces
 */

const ESCALATION_LABELS = ['', '🤝 Collaborative', '📋 Probing', '⚡ Assertive', '🔥 Hard Push', '🚨 Final / Take-Away']
const ESCALATION_COLORS = ['', '#1ab87a', '#86efac', '#d97706', '#ea580c', '#dc2626']

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"

function Section({ title, icon, children }) {
    return (
        <div style={{
            marginBottom: '10px',
            background: 'rgba(255,255,255,0.60)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.8)',
            borderRadius: '14px',
            overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)',
        }}>
            <div style={{
                padding: '7px 12px',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'rgba(255,255,255,0.4)',
            }}>
                <span style={{ fontSize: '13px' }}>{icon}</span>
                <span style={{ fontSize: '10px', fontWeight: '700', color: 'rgba(0,0,0,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</span>
            </div>
            <div style={{ padding: '10px 12px' }}>{children}</div>
        </div>
    )
}

function Row({ label, value, valueColor = 'rgba(0,0,0,0.75)' }) {
    if (!value) return null
    return (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '5px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', minWidth: '84px', paddingTop: '1px', flexShrink: 0, fontWeight: '500' }}>{label}</span>
            <span style={{ fontSize: '11px', color: valueColor, flex: 1, wordBreak: 'break-word', lineHeight: '1.4' }}>{value}</span>
        </div>
    )
}

function TagList({ items, bg = 'rgba(29,107,243,0.10)', color = '#1a5cd8' }) {
    if (!items?.length) return <span style={{ fontSize: '10px', color: 'rgba(0,0,0,0.25)' }}>None detected yet</span>
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {items.map((item, i) => (
                <span key={i} style={{
                    fontSize: '10px', background: bg, color,
                    padding: '2px 9px', borderRadius: '99px',
                    border: `1px solid ${color}33`,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                    fontWeight: '500',
                }}>
                    {item}
                </span>
            ))}
        </div>
    )
}

function EscalationMeter({ level = 1 }) {
    return (
        <div>
            <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} style={{
                        flex: 1, height: '5px', borderRadius: '99px',
                        background: i <= level ? ESCALATION_COLORS[level] : 'rgba(0,0,0,0.08)',
                        transition: 'background 0.3s',
                    }} />
                ))}
            </div>
            <div style={{ fontSize: '11px', color: ESCALATION_COLORS[level] || 'rgba(0,0,0,0.4)', fontWeight: '600' }}>
                Level {level}/5 — {ESCALATION_LABELS[level] || 'Unknown'}
            </div>
        </div>
    )
}

export default function IntelligenceDashboard({ thread }) {
    if (!thread) {
        return (
            <div style={{
                width: '280px', flexShrink: 0,
                borderLeft: '1px solid rgba(255,255,255,0.6)',
                background: 'rgba(255,255,255,0.30)',
                backdropFilter: 'blur(32px) saturate(160%)',
                WebkitBackdropFilter: 'blur(32px) saturate(160%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONT,
            }}>
                <div style={{ color: 'rgba(0,0,0,0.22)', fontSize: '12px', textAlign: 'center', padding: '20px', lineHeight: 1.7 }}>
                    Select a thread<br />to view intelligence
                </div>
            </div>
        )
    }

    const intel   = thread.counterparty_intel    || {}
    const profile = thread.counterparty_profile  || {}
    const state   = thread.thread_state          || {}
    const hasIntel   = Object.keys(intel).length   > 0
    const hasProfile = Object.keys(profile).length > 0
    const hasState   = Object.keys(state).length   > 0

    return (
        <div style={{
            width: '280px', flexShrink: 0,
            borderLeft: '1px solid rgba(255,255,255,0.6)',
            background: 'rgba(255,255,255,0.32)',
            backdropFilter: 'blur(32px) saturate(160%)',
            WebkitBackdropFilter: 'blur(32px) saturate(160%)',
            overflowY: 'auto',
            fontFamily: FONT,
            boxShadow: '-1px 0 0 rgba(0,0,0,0.04)',
        }}>
            {/* Header */}
            <div style={{
                padding: '10px 13px',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
                background: 'rgba(255,255,255,0.5)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                boxShadow: '0 1px 0 rgba(255,255,255,0.7)',
            }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: 'rgba(0,0,0,0.42)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    ⚡ Intelligence
                </div>
            </div>

            <div style={{ padding: '10px 10px 24px' }}>

                {/* ── COUNTERPARTY INTEL ─────────────────────────────── */}
                <Section title="Counterparty Research" icon="🔍">
                    {!hasIntel ? (
                        <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.3)', lineHeight: '1.6' }}>
                            Research fires on first email.<br />
                            Will appear on next thread load.
                        </div>
                    ) : (
                        <>
                            <Row label="Company" value={intel.company_name} valueColor="#1a5cd8" />
                            <Row label="Overview" value={intel.company_summary?.slice(0, 180) + (intel.company_summary?.length > 180 ? '…' : '')} />
                            <Row label="Financials" value={intel.financial_health?.slice(0, 120) + (intel.financial_health?.length > 120 ? '…' : '')} />
                            {intel.recent_news && intel.recent_news !== 'None found' && (
                                <Row label="News" value={intel.recent_news?.slice(0, 150) + (intel.recent_news?.length > 150 ? '…' : '')} valueColor="#b45309" />
                            )}
                            <Row label="Person" value={intel.person_name} valueColor="#6040cc" />
                            {intel.person_summary && (
                                <Row label="Background" value={intel.person_summary?.slice(0, 150) + (intel.person_summary?.length > 150 ? '…' : '')} />
                            )}
                            {intel.leverage_signals?.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '5px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Leverage Signals</div>
                                    {intel.leverage_signals.map((s, i) => (
                                        <div key={i} style={{
                                            fontSize: '10px', color: '#b45309',
                                            background: 'rgba(251,191,36,0.10)',
                                            border: '1px solid rgba(251,191,36,0.25)',
                                            padding: '4px 8px', marginBottom: '3px', borderRadius: '8px',
                                            fontWeight: '500',
                                        }}>
                                            ⚡ {s}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {intel.negotiating_implications && (
                                <div style={{
                                    marginTop: '8px', fontSize: '10px', color: '#0e8a58',
                                    background: 'rgba(26,184,122,0.10)',
                                    border: '1px solid rgba(26,184,122,0.25)',
                                    borderLeft: '3px solid #1ab87a',
                                    padding: '6px 8px', borderRadius: '0 8px 8px 0',
                                    lineHeight: '1.5',
                                }}>
                                    → {intel.negotiating_implications}
                                </div>
                            )}
                        </>
                    )}
                </Section>

                {/* ── BEHAVIORAL PROFILE ────────────────────────────── */}
                <Section title="Behavioral Profile" icon="🧠">
                    {!hasProfile ? (
                        <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.3)', lineHeight: '1.6' }}>Profile builds with each exchange.</div>
                    ) : (
                        <>
                            <Row label="Style"       value={profile.communication_style} valueColor="#6040cc" />
                            <Row label="Personality" value={profile.personality_type}    valueColor="#1a5cd8" />
                            <Row label="Authority"   value={profile.decision_authority}  valueColor={
                                profile.decision_authority === 'confirmed_decision_maker' ? '#0e8a58' :
                                profile.decision_authority === 'gatekeeper' ? '#b45309' : 'rgba(0,0,0,0.5)'
                            } />
                            <Row label="Ego"    value={profile.ego_sensitivity} valueColor={
                                profile.ego_sensitivity === 'high' ? '#dc2626' :
                                profile.ego_sensitivity === 'medium' ? '#d97706' : '#0e8a58'
                            } />
                            <Row label="Emotional" value={profile.emotional_baseline} />
                            {profile.trust_level != null && (
                                <div style={{ marginBottom: '8px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '4px', fontWeight: '500' }}>Trust Level</div>
                                    <div style={{ height: '5px', background: 'rgba(0,0,0,0.08)', borderRadius: '99px', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', borderRadius: '99px',
                                            width: `${(profile.trust_level * 100).toFixed(0)}%`,
                                            background: profile.trust_level > 0.6 ? '#1ab87a' : profile.trust_level > 0.3 ? '#d97706' : '#dc2626',
                                            transition: 'width 0.5s',
                                        }} />
                                    </div>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginTop: '2px' }}>{(profile.trust_level * 100).toFixed(0)}%</div>
                                </div>
                            )}
                            {profile.detected_pressure_points?.length > 0 && (
                                <div style={{ marginBottom: '7px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '4px', fontWeight: '500' }}>Pressure Points</div>
                                    <TagList items={profile.detected_pressure_points} bg="rgba(251,191,36,0.12)" color="#b45309" />
                                </div>
                            )}
                            {profile.tells?.length > 0 && (
                                <div style={{ marginBottom: '7px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '4px', fontWeight: '500' }}>Confirmed Tells</div>
                                    <TagList items={profile.tells} bg="rgba(220,38,38,0.10)" color="#dc2626" />
                                </div>
                            )}
                            {profile.red_lines_detected?.length > 0 && (
                                <div style={{ marginBottom: '7px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '4px', fontWeight: '500' }}>Red Lines</div>
                                    <TagList items={profile.red_lines_detected} bg="rgba(220,38,38,0.10)" color="#dc2626" />
                                </div>
                            )}
                            {profile.bluff_signals_seen?.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '4px', fontWeight: '500' }}>Bluff Signals</div>
                                    <TagList items={profile.bluff_signals_seen} bg="rgba(96,64,204,0.10)" color="#6040cc" />
                                </div>
                            )}
                        </>
                    )}
                </Section>

                {/* ── STRATEGIC STATE ───────────────────────────────── */}
                <Section title="Strategic State" icon="♟️">
                    {!hasState ? (
                        <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.3)', lineHeight: '1.6' }}>Strategy tracks after first analysis.</div>
                    ) : (
                        <>
                            <div style={{ marginBottom: '10px' }}>
                                <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '5px', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Escalation Level</div>
                                <EscalationMeter level={state.escalation_level || 1} />
                            </div>
                            {state.strategic_game_plan && (
                                <div style={{
                                    marginBottom: '8px', padding: '7px 9px',
                                    background: 'rgba(26,184,122,0.10)',
                                    border: '1px solid rgba(26,184,122,0.25)',
                                    borderLeft: '3px solid #1ab87a',
                                    borderRadius: '0 8px 8px 0',
                                    fontSize: '10px', color: '#0e8a58', lineHeight: '1.5',
                                }}>
                                    {state.strategic_game_plan}
                                </div>
                            )}
                            {state.planned_next_move && (
                                <Row label="Next Move" value={state.planned_next_move} valueColor="#1a5cd8" />
                            )}
                            <Row label="Move #" value={state.move_number ? `#${state.move_number}` : null} valueColor="rgba(0,0,0,0.4)" />
                            {state.concessions_we_made?.length > 0 && (
                                <div style={{ marginBottom: '6px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '3px', fontWeight: '500' }}>We Conceded</div>
                                    {state.concessions_we_made.slice(-3).map((c, i) => (
                                        <div key={i} style={{ fontSize: '10px', color: '#dc2626', marginBottom: '2px' }}>↓ {c}</div>
                                    ))}
                                </div>
                            )}
                            {state.concessions_they_made?.length > 0 && (
                                <div style={{ marginBottom: '6px' }}>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '3px', fontWeight: '500' }}>They Conceded</div>
                                    {state.concessions_they_made.slice(-3).map((c, i) => (
                                        <div key={i} style={{ fontSize: '10px', color: '#0e8a58', marginBottom: '2px' }}>↑ {c}</div>
                                    ))}
                                </div>
                            )}
                            {state.thread_observations?.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.38)', marginBottom: '4px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Observations</div>
                                    {state.thread_observations.slice(-4).map((obs, i) => (
                                        <div key={i} style={{
                                            fontSize: '10px', color: 'rgba(0,0,0,0.55)',
                                            padding: '4px 0',
                                            borderBottom: '1px solid rgba(0,0,0,0.05)',
                                            lineHeight: '1.5',
                                        }}>
                                            · {obs}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </Section>

            </div>
        </div>
    )
}
