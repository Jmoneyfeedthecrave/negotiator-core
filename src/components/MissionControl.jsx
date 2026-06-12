import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../api/supabaseClient'

/**
 * MissionControl.jsx — home view for supervising autonomous negotiations.
 *
 * Two live sections, refreshed every 20s:
 *   1. Attention queue — email_threads where needs_attention = true, with
 *      reason-aware framing and one-click Approve & send (calls /api/email-send
 *      on the thread's pending draft).
 *   2. Portfolio — every active thread with derived state, mode, escalation,
 *      trust read, concession tally, and last activity.
 *
 * Props:
 *   onOpenThread?: (threadId: string) => void
 *     Called when a row or "Review" is clicked. Wire this in App.jsx to switch
 *     to the Email Negotiator tab with the thread selected (see notes).
 */

// ── Command Deck tokens ───────────────────────────────────────────────────────
const T = {
    bg: '#0B1220', panel: '#101A2C', raised: '#16233A',
    line: 'rgba(122,162,224,0.14)', lineStrong: 'rgba(122,162,224,0.28)',
    text: '#E6EDF7', dim: 'rgba(230,237,247,0.6)', faint: 'rgba(230,237,247,0.36)',
    blue: '#4D9FFF', green: '#2EE6A8', amber: '#F5B83D', red: '#FF5C5C', violet: '#A78BFA',
    fontHead: '"Space Grotesk", sans-serif',
    fontUi: '"Inter", sans-serif',
    fontMono: '"IBM Plex Mono", "JetBrains Mono", monospace',
}

const FONTS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.mc-root::-webkit-scrollbar { width: 5px; }
.mc-root::-webkit-scrollbar-thumb { background: rgba(122,162,224,0.28); border-radius: 99px; }
@keyframes mcBlink { 0%,100%{opacity:1} 50%{opacity:.3} }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`

// ── helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso) {
    if (!iso) return '—'
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)} min ago`
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
    return `${Math.floor(s / 86400)} d ago`
}

function classifyReason(reason) {
    if (!reason) return { tone: 'amber', icon: 'REVIEW', title: 'Needs review' }
    if (reason.startsWith('agent_flagged')) return { tone: 'red', icon: 'AGENT FLAG', title: 'Agent requested your judgment' }
    if (reason.startsWith('low_confidence')) return { tone: 'amber', icon: reason.match(/\(([\d.]+)/)?.[1] ? `CONF ${reason.match(/\(([\d.]+)/)[1]}` : 'LOW CONF', title: 'Draft held — confidence below your threshold' }
    if (reason.startsWith('circuit_breaker')) return { tone: 'red', icon: 'BREAKER', title: 'Circuit breaker tripped — dropped to coached' }
    if (reason.startsWith('processing_error')) return { tone: 'red', icon: 'ERROR', title: 'Processing failed — needs a look' }
    if (reason === 'draft_ready') return { tone: 'amber', icon: 'DRAFT', title: 'Draft ready for your approval' }
    if (reason === 'processing_dispatch_failed') return { tone: 'red', icon: 'ERROR', title: 'Inbound email failed to process' }
    return { tone: 'amber', icon: 'REVIEW', title: reason }
}

function deriveState(thread, latestOutbound, latestInbound) {
    if (thread.status && thread.status !== 'active') return { label: 'CLOSED', tone: T.green }
    if (thread.needs_attention) return { label: 'NEEDS YOU', tone: T.red }
    if (latestInbound?.status === 'processing') return { label: 'AGENT WORKING', tone: T.blue }
    if (latestOutbound?.send_status === 'scheduled') return { label: 'SEND SCHEDULED', tone: T.violet }
    if (latestOutbound?.send_status === 'sent') return { label: 'AWAITING REPLY', tone: T.dim }
    return { label: 'OPEN', tone: T.dim }
}

// ── component ─────────────────────────────────────────────────────────────────
export default function MissionControl({ onOpenThread }) {
    const [threads, setThreads] = useState([])
    const [emailsByThread, setEmailsByThread] = useState({})
    const [loading, setLoading] = useState(true)
    const [approving, setApproving] = useState(null)
    const [error, setError] = useState(null)

    const load = useCallback(async () => {
        try {
            const { data: threadRows, error: tErr } = await supabase
                .from('email_threads')
                .select('id, subject, counterparty_email, domain, mode, status, needs_attention, attention_reason, thread_state, counterparty_profile, our_position, position_confirmed, updated_at')
                .order('updated_at', { ascending: false })
                .limit(50)
            if (tErr) throw tErr

            const ids = (threadRows || []).map(t => t.id)
            let byThread = {}
            if (ids.length) {
                const { data: emailRows, error: eErr } = await supabase
                    .from('emails')
                    .select('id, thread_id, direction, status, send_status, scheduled_send_at, drafted_reply, claude_analysis, created_at')
                    .in('thread_id', ids)
                    .order('created_at', { ascending: true })
                if (eErr) throw eErr
                for (const e of emailRows || []) {
                    (byThread[e.thread_id] = byThread[e.thread_id] || []).push(e)
                }
            }
            setThreads(threadRows || [])
            setEmailsByThread(byThread)
            setError(null)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
        const iv = setInterval(load, 20000)
        return () => clearInterval(iv)
    }, [load])

    async function approveAndSend(thread) {
        const pending = (emailsByThread[thread.id] || [])
            .filter(e => e.direction === 'outbound' && e.send_status === 'pending_approval')
            .pop()
        if (!pending) { setError('No pending draft found on this thread.'); return }
        setApproving(thread.id)
        try {
            const r = await fetch('/api/email-send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_id: pending.id }),
            })
            if (!r.ok) {
                const d = await r.json().catch(() => ({}))
                throw new Error(d.error || `Send failed (${r.status})`)
            }
            await load()
        } catch (err) {
            setError(err.message)
        } finally {
            setApproving(null)
        }
    }

    const attention = threads.filter(t => t.needs_attention)
    const active = threads.filter(t => !t.status || t.status === 'active')
    const agentWorking = active.some(t => (emailsByThread[t.id] || []).some(e => e.status === 'processing'))

    // ── styles ──
    const btn = (variant) => ({
        fontFamily: T.fontUi, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
        padding: '6px 13px', borderRadius: 7,
        border: `1px solid ${variant === 'primary' ? T.green : T.lineStrong}`,
        background: variant === 'primary' ? T.green : 'transparent',
        color: variant === 'primary' ? '#04140D' : T.dim,
    })
    const sectionH = {
        fontFamily: T.fontHead, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: T.dim, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 9,
    }
    const countPill = (hot) => ({
        fontFamily: T.fontMono, fontSize: 10.5, borderRadius: 99, padding: '1px 8px',
        background: hot ? T.red : T.raised, color: hot ? T.bg : T.dim,
    })

    return (
        <div className="mc-root" style={{ height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', background: T.bg, color: T.text, fontFamily: T.fontUi, fontSize: 13 }}>
            <style>{FONTS_CSS}</style>

            {/* status strip */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${T.line}`, background: T.panel, position: 'sticky', top: 0, zIndex: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 18px', borderRight: `1px solid ${T.line}` }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg,#1d4ed8,#4D9FFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.fontHead, fontWeight: 700, fontSize: 13 }}>N</span>
                    <b style={{ fontFamily: T.fontHead, fontWeight: 600, fontSize: 14 }}>Mission Control</b>
                </div>
                <div style={{ padding: '11px 16px', borderRight: `1px solid ${T.line}`, fontSize: 11, color: T.dim, display: 'flex', gap: 7, alignItems: 'center' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: agentWorking ? T.blue : T.green, display: 'inline-block', animation: 'mcBlink 2.2s ease infinite' }} />
                    AGENT <b style={{ fontFamily: T.fontMono, color: agentWorking ? T.blue : T.green }}>{agentWorking ? 'WORKING' : 'ON DUTY'}</b>
                </div>
                <div style={{ padding: '11px 16px', borderRight: `1px solid ${T.line}`, fontSize: 11, color: T.dim }}>
                    ACTIVE <b style={{ fontFamily: T.fontMono, color: T.text }}>{active.length}</b>
                </div>
                <div style={{ padding: '11px 16px', borderRight: `1px solid ${T.line}`, fontSize: 11, color: T.dim }}>
                    NEEDS YOU <b style={{ fontFamily: T.fontMono, color: attention.length ? T.red : T.text }}>{attention.length}</b>
                </div>
                <span style={{ flex: 1 }} />
                {error && <span style={{ fontSize: 11, color: T.red, marginRight: 14 }}>{error}</span>}
            </div>

            <div style={{ maxWidth: 1160, margin: '0 auto', padding: '20px 26px 40px' }}>

                {/* ── attention queue ── */}
                <h2 style={sectionH}>Needs your call <span style={countPill(attention.length > 0)}>{attention.length}</span></h2>
                {attention.length === 0 && (
                    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: '16px 18px', marginBottom: 28, fontSize: 12.5, color: T.faint }}>
                        Nothing waiting on you. The agent is handling it.
                    </div>
                )}
                {attention.length > 0 && (
                    <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
                        {attention.map(t => {
                            const c = classifyReason(t.attention_reason)
                            const toneColor = c.tone === 'red' ? T.red : T.amber
                            const pending = (emailsByThread[t.id] || []).filter(e => e.direction === 'outbound' && e.send_status === 'pending_approval').pop()
                            const conf = pending?.claude_analysis?.confidence ?? (emailsByThread[t.id] || []).filter(e => e.claude_analysis).pop()?.claude_analysis?.confidence
                            return (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${toneColor}`, borderRadius: 10, padding: '13px 16px', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: T.fontMono, fontSize: 9, letterSpacing: '0.1em', color: toneColor, border: `1px solid ${toneColor}55`, borderRadius: 5, padding: '3px 7px', flexShrink: 0 }}>{c.icon}</span>
                                    <div style={{ flex: 1, minWidth: 220 }}>
                                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{t.subject || '(no subject)'} — {c.title}</div>
                                        <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.45 }}>
                                            {t.counterparty_email}
                                            {typeof conf === 'number' && <> · agent confidence <b style={{ fontFamily: T.fontMono, color: T.text }}>{conf.toFixed(2)}</b></>}
                                            {pending?.drafted_reply && <> · draft: “{pending.drafted_reply.slice(0, 90)}…”</>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                                        <button style={btn()} onClick={() => onOpenThread?.(t.id)}>Review</button>
                                        {pending && (
                                            <button
                                                style={{ ...btn('primary'), opacity: approving === t.id ? 0.6 : 1 }}
                                                disabled={approving === t.id}
                                                onClick={() => approveAndSend(t)}
                                            >
                                                {approving === t.id ? 'Sending…' : 'Approve & send'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* ── portfolio ── */}
                <h2 style={{ ...sectionH }}>All negotiations <span style={countPill(false)}>{active.length}</span></h2>
                <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.5fr) 118px 110px 130px 130px 90px', gap: 14, padding: '9px 18px', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.faint, background: 'rgba(230,237,247,0.02)', borderBottom: `1px solid ${T.line}` }}>
                        <span>Negotiation</span><span>State</span><span>Mode · Move</span><span>Trust read</span><span>Concessions</span><span>Last move</span>
                    </div>

                    {loading && <div style={{ padding: 24, color: T.faint, fontSize: 12 }}>Loading the board…</div>}
                    {!loading && active.length === 0 && (
                        <div style={{ padding: '32px 24px', color: T.faint, fontSize: 12.5, textAlign: 'center' }}>
                            No active negotiations. Start one from the Email Negotiator, or send a test inbound.
                        </div>
                    )}

                    {active.map(t => {
                        const emails = emailsByThread[t.id] || []
                        const latestOutbound = emails.filter(e => e.direction === 'outbound').pop()
                        const latestInbound = emails.filter(e => e.direction === 'inbound').pop()
                        const st = deriveState(t, latestOutbound, latestInbound)
                        const state = t.thread_state || {}
                        const profile = t.counterparty_profile || {}
                        const trust = typeof profile.trust_level === 'number' ? Math.round(profile.trust_level * 100) : null
                        const trustColor = trust == null ? T.faint : trust < 40 ? T.red : trust < 70 ? T.amber : T.green
                        const weMade = (state.concessions_we_made || []).length
                        const theyMade = (state.concessions_they_made || []).length
                        return (
                            <div
                                key={t.id}
                                onClick={() => onOpenThread?.(t.id)}
                                style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.5fr) 118px 110px 130px 130px 90px', gap: 14, alignItems: 'center', padding: '13px 18px', borderBottom: `1px solid ${T.line}`, cursor: onOpenThread ? 'pointer' : 'default' }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject || '(no subject)'}</div>
                                    <div style={{ fontSize: 10.5, color: T.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {t.counterparty_email} · {emails.length} emails{t.position_confirmed === false ? ' · position unconfirmed' : ''}
                                    </div>
                                </div>
                                <span><span style={{ fontSize: 9, letterSpacing: '0.1em', fontWeight: 600, padding: '3px 8px', borderRadius: 5, color: st.tone, border: `1px solid ${st.tone}55`, whiteSpace: 'nowrap' }}>{st.label}</span></span>
                                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.dim }}>
                                    {(t.mode || 'coached').slice(0, 4).toUpperCase()} · m{state.move_number || 1}
                                    {state.escalation_level ? ` · e${state.escalation_level}` : ''}
                                </span>
                                <span style={{ fontFamily: T.fontMono, fontSize: 11, color: trustColor }}>
                                    {trust == null ? 'no read yet' : `${trust}% trust`}
                                </span>
                                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.dim }}>
                                    us {weMade} · them {theyMade}
                                </span>
                                <span style={{ fontSize: 10.5, color: T.faint }}>{timeAgo(t.updated_at)}</span>
                            </div>
                        )
                    })}
                </div>

                <p style={{ marginTop: 16, fontSize: 11, color: T.faint, lineHeight: 1.6 }}>
                    The agent acts on its own inside each thread's brief and escalates on{' '}
                    <b style={{ color: T.dim, fontWeight: 500 }}>low confidence</b>,{' '}
                    <b style={{ color: T.dim, fontWeight: 500 }}>new terms outside the brief</b>,{' '}
                    <b style={{ color: T.dim, fontWeight: 500 }}>circuit breakers</b>, and{' '}
                    <b style={{ color: T.dim, fontWeight: 500 }}>processing errors</b>. Approving a draft clears its flag.
                </p>
            </div>
        </div>
    )
}
