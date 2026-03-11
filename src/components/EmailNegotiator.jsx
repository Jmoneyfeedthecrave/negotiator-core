import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import IntelligenceDashboard from './IntelligenceDashboard'
import PositionBriefCard from './PositionBriefCard'
import StartNegotiationWizard from './StartNegotiationWizard'

const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
)

const WEBHOOK_URL = `${window.location.origin}/api/email-inbound`

const STATUS_COLORS = {
    pending: '#fbbf24',
    sent: '#86efac',
    skipped: '#475569',
    auto_sent: '#a5b4fc',
    scheduled: '#38bdf8',
}

function formatScheduledTime(iso) {
    if (!iso) return null
    const d = new Date(iso)
    const now = new Date()
    const diffMs = d - now
    if (diffMs < 0) return 'Ready to send'
    const diffH = Math.floor(diffMs / 3600000)
    const diffM = Math.floor((diffMs % 3600000) / 60000)
    const label = diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`
    const day = d.toLocaleDateString('en-US', { weekday: 'short' })
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${day} ${time} (in ${label})`
}

export default function EmailNegotiator() {
    const [threads, setThreads] = useState([])
    const [selectedThread, setSelectedThread] = useState(null)
    const [emails, setEmails] = useState([])
    const [loading, setLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [draftEdit, setDraftEdit] = useState('')
    const [showManual, setShowManual] = useState(false)
    const [manual, setManual] = useState({ from: '', subject: '', body: '', domain: 'Email Negotiation', mode: 'coached' })
    const [log, setLog] = useState('')
    const [showOutcome, setShowOutcome] = useState(false)
    const [showWizard, setShowWizard] = useState(false)
    const [briefDismissed, setBriefDismissed] = useState({})
    const [outcome, setOutcome] = useState({ outcome: 'win', deal_value: '', notes: '' })
    const [reflectLoading, setReflectLoading] = useState(false)
    const [scheduledTime, setScheduledTime] = useState(null)
    const [timingReason, setTimingReason] = useState('')
    const [showTimingReason, setShowTimingReason] = useState(false)
    const timerRef = useRef(null)
    const [scheduledDisplay, setScheduledDisplay] = useState('')

    const loadThreads = useCallback(async () => {
        const { data } = await supabase
            .from('email_threads')
            .select('*, counterparty_intel, counterparty_profile, thread_state')
            .order('updated_at', { ascending: false })
        setThreads(data || [])
    }, [])

    // Update scheduled time display every minute
    useEffect(() => {
        if (!scheduledTime) return
        const update = () => setScheduledDisplay(formatScheduledTime(scheduledTime))
        update()
        timerRef.current = setInterval(update, 60000)
        return () => clearInterval(timerRef.current)
    }, [scheduledTime])

    useEffect(() => { loadThreads() }, [loadThreads])

    async function selectThread(thread) {
        // Always fetch fresh thread with intelligence columns
        const { data: fresh } = await supabase
            .from('email_threads')
            .select('*, counterparty_intel, counterparty_profile, thread_state')
            .eq('id', thread.id)
            .single()
        setSelectedThread(fresh || thread)
        const { data } = await supabase.from('emails').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true })
        setEmails(data || [])
        // Find latest pending inbound — pick up scheduled time from it
        const pending = (data || []).filter(e => e.direction === 'inbound' && e.status === 'pending').pop()
        setDraftEdit(pending?.drafted_reply || '')
        if (pending?.scheduled_send_at) {
            setScheduledTime(pending.scheduled_send_at)
            setTimingReason(pending.claude_analysis?.timing_reasoning || '')
        } else {
            setScheduledTime(null)
            setTimingReason('')
        }
        setShowTimingReason(false)
    }

    const pendingEmail = emails.filter(e => e.direction === 'inbound' && e.status === 'pending').pop()

    async function handleApproveAndSend() {
        if (!pendingEmail) return
        setSending(true)
        setLog('Sending now...')
        try {
            // Override scheduled send — send immediately
            await supabase.from('emails').update({ send_status: 'sending_now', scheduled_send_at: null }).eq('id', pendingEmail.id)
            const res = await fetch('/api/email-send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_id: pendingEmail.id, custom_reply: draftEdit }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setLog(`✅ Sent to ${data.sent_to}`)
            setScheduledTime(null)
            await selectThread(selectedThread)
            await loadThreads()
        } catch (err) {
            setLog(`❌ ${err.message}`)
        } finally {
            setSending(false)
        }
    }

    async function handleConfirmSchedule() {
        if (!pendingEmail || !scheduledTime) return
        setLog(`📅 Scheduled for ${formatScheduledTime(scheduledTime)}`)
    }

    async function handleReschedule(hoursFromNow) {
        if (!pendingEmail) return
        const newTime = new Date(Date.now() + hoursFromNow * 3600000)
        // Push to business hours
        if (newTime.getHours() < 8) newTime.setHours(10, 0, 0, 0)
        if (newTime.getHours() >= 17) { newTime.setDate(newTime.getDate() + 1); newTime.setHours(10, 0, 0, 0) }
        while (newTime.getDay() === 0 || newTime.getDay() === 6) newTime.setDate(newTime.getDate() + 1)
        const iso = newTime.toISOString()
        await supabase.from('emails').update({ scheduled_send_at: iso }).eq('id', pendingEmail.id)
        setScheduledTime(iso)
        setLog(`📅 Rescheduled to ${formatScheduledTime(iso)}`)
    }

    async function handleSkip() {
        if (!pendingEmail) return
        await supabase.from('emails').update({ status: 'skipped' }).eq('id', pendingEmail.id)
        setLog('Skipped.')
        await selectThread(selectedThread)
    }

    async function handleToggleMode() {
        if (!selectedThread) return
        const newMode = selectedThread.mode === 'coached' ? 'autonomous' : 'coached'
        await supabase.from('email_threads').update({ mode: newMode }).eq('id', selectedThread.id)
        setSelectedThread(t => ({ ...t, mode: newMode }))
        setThreads(ts => ts.map(t => t.id === selectedThread.id ? { ...t, mode: newMode } : t))
        setLog(newMode === 'autonomous' ? '🤖 Autonomous — replies fire instantly' : '👁 Coached — you review before sending')
    }

    async function handleMarkOutcome(e) {
        e.preventDefault()
        if (!selectedThread) return
        setReflectLoading(true)
        setLog('Analyzing negotiation and extracting lessons…')
        try {
            const res = await fetch('/.netlify/functions/negotiation-reflect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    thread_id: selectedThread.id,
                    outcome: outcome.outcome,
                    deal_value: outcome.deal_value ? parseFloat(outcome.deal_value) : null,
                    notes: outcome.notes || null,
                }),
            })
            const data = await res.json()
            setLog(`✅ ${data.patterns} lessons extracted and added to Knowledge Library`)
            setShowOutcome(false)
        } catch (err) {
            setLog('❌ Reflection failed: ' + err.message)
        } finally {
            setReflectLoading(false)
        }
    }

    async function handleConfirmPosition(fields) {
        if (!selectedThread) return
        await supabase.from('email_threads')
            .update({ our_position: fields, position_confirmed: true })
            .eq('id', selectedThread.id)
        setSelectedThread(t => ({ ...t, our_position: fields, position_confirmed: true }))
        setThreads(ts => ts.map(t => t.id === selectedThread.id ? { ...t, our_position: fields, position_confirmed: true } : t))
    }

    function handleDismissBrief() {
        if (selectedThread) setBriefDismissed(d => ({ ...d, [selectedThread.id]: true }))
    }

    async function handleManualSubmit() {
        setLoading(true)
        setLog('Processing email...')
        try {
            const res = await fetch('/api/email-inbound', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    From: manual.from,
                    To: 'jdquist2025@gmail.com',
                    Subject: manual.subject,
                    TextBody: manual.body,
                    domain: manual.domain,
                    mode: manual.mode,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setLog(`✅ Processed — ${data.technique_detected || 'analysis complete'}`)
            setShowManual(false)
            setManual({ from: '', subject: '', body: '', domain: 'Email Negotiation', mode: 'coached' })
            await loadThreads()
            // Auto-select the thread
            if (data.thread_id) {
                const { data: t } = await supabase.from('email_threads').select('*').eq('id', data.thread_id).single()
                if (t) await selectThread(t)
            }
        } catch (err) {
            setLog(`❌ ${err.message}`)
        } finally {
            setLoading(false)
        }
    }

    const s = {
        container: {
            display: 'flex', height: 'calc(100vh - 50px)',
            fontFamily: 'var(--font-ui)', color: 'var(--text-primary)',
        },
        sidebar: {
            width: '252px', flexShrink: 0,
            background: 'rgba(255,255,255,0.52)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            borderRight: '1px solid rgba(255,255,255,0.7)',
            boxShadow: '1px 0 0 rgba(0,0,0,0.05)',
            display: 'flex', flexDirection: 'column',
        },
        sidebarHeader: {
            padding: '11px 13px',
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
        sidebarTitle: {
            color: 'var(--text-muted)', fontSize: '10px',
            fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase',
        },
        threadList: { flex: 1, overflowY: 'auto' },
        threadItem: (selected) => ({
            padding: '10px 13px',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            cursor: 'pointer',
            background: selected
                ? 'rgba(29,107,243,0.10)'
                : 'transparent',
            borderLeft: selected ? '3px solid var(--blue)' : '3px solid transparent',
            transition: 'all 0.15s var(--ease)',
        }),
        threadFrom: { fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        threadSubject: { fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
        mainHeader: {
            padding: '11px 17px',
            background: 'rgba(255,255,255,0.55)',
            backdropFilter: 'blur(24px) saturate(160%)',
            WebkitBackdropFilter: 'blur(24px) saturate(160%)',
            borderBottom: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.7)',
            flexShrink: 0,
        },
        emailList: {
            flex: 1, overflowY: 'auto',
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: '8px',
        },
        emailBubble: (dir) => ({
            maxWidth: '74%',
            marginLeft: dir === 'outbound' ? 'auto' : '0',
            background: dir === 'outbound'
                ? 'linear-gradient(145deg, #4a90f5 0%, #1d6bf3 100%)'
                : 'rgba(255,255,255,0.75)',
            backdropFilter: dir === 'outbound' ? 'none' : 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: dir === 'outbound' ? 'none' : 'blur(20px) saturate(160%)',
            border: `1px solid ${dir === 'outbound' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.85)'}`,
            borderRadius: dir === 'outbound' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            padding: '11px 15px',
            color: dir === 'outbound' ? '#fff' : 'var(--text-primary)',
            boxShadow: dir === 'outbound'
                ? '0 4px 16px rgba(29,107,243,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'
                : '0 2px 12px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
        }),
        emailMeta: { fontSize: '10px', color: 'inherit', opacity: 0.6, marginBottom: '5px', fontWeight: '500' },
        emailBody: { fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 },
        analysisCard: {
            background: 'rgba(255,255,255,0.65)',
            backdropFilter: 'blur(20px) saturate(140%)',
            WebkitBackdropFilter: 'blur(20px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.8)',
            borderRadius: '14px',
            padding: '10px 13px', marginTop: '8px', fontSize: '11px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)',
            color: 'var(--text-primary)',
        },
        analysisPill: {
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            background: 'rgba(117,80,233,0.10)',
            color: '#6040cc',
            border: '1px solid rgba(117,80,233,0.2)',
            padding: '2px 9px', borderRadius: '99px',
            marginRight: '5px', marginBottom: '4px',
            fontSize: '10px', fontWeight: '600',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
        },
        draftPanel: {
            borderTop: '1px solid rgba(0,0,0,0.06)',
            padding: '12px 17px',
            background: 'rgba(255,255,255,0.70)',
            backdropFilter: 'blur(40px) saturate(200%)',
            WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            flexShrink: 0,
            boxShadow: '0 -1px 0 rgba(255,255,255,0.9)',
        },
        draftLabel: {
            color: 'var(--text-muted)', fontSize: '10px',
            fontWeight: '700', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '7px',
        },
        draftTextarea: {
            width: '100%', minHeight: '90px',
            background: 'rgba(255,255,255,0.70)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: '12px',
            color: 'var(--text-primary)',
            padding: '10px 13px',
            fontFamily: 'var(--font-mono)', fontSize: '12px',
            resize: 'vertical', boxSizing: 'border-box', outline: 'none',
            boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.04)',
        },
        btnRow: { display: 'flex', gap: '7px', marginTop: '9px', alignItems: 'center', flexWrap: 'wrap' },
        logMsg: { fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' },
        empty: { color: 'rgba(0,0,0,0.2)', textAlign: 'center', marginTop: '80px', fontSize: '13px' },
        modal: {
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.25)',
            backdropFilter: 'blur(12px) saturate(140%)',
            WebkitBackdropFilter: 'blur(12px) saturate(140%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        modalBox: {
            background: 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(48px) saturate(200%)',
            WebkitBackdropFilter: 'blur(48px) saturate(200%)',
            border: '1px solid rgba(255,255,255,0.9)',
            borderRadius: '24px',
            padding: '24px', width: '500px', maxWidth: '92vw',
            boxShadow: '0 24px 64px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.95)',
        },
        modalTitle: { color: 'var(--text-primary)', marginBottom: '16px', fontSize: '15px', fontWeight: '600' },
        field: { marginBottom: '12px' },
        fieldLabel: {
            color: 'var(--text-muted)', fontSize: '10px', fontWeight: '700',
            letterSpacing: '0.07em', textTransform: 'uppercase', display: 'block', marginBottom: '5px',
        },
        fieldInput: {
            width: '100%',
            background: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(0,0,0,0.14)', borderRadius: '10px',
            color: 'var(--text-primary)', padding: '8px 11px',
            fontFamily: 'var(--font-ui)', fontSize: '13px',
            boxSizing: 'border-box', outline: 'none',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)',
        },
        fieldTextarea: {
            width: '100%',
            background: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(0,0,0,0.14)', borderRadius: '10px',
            color: 'var(--text-primary)', padding: '8px 11px',
            fontFamily: 'var(--font-ui)', fontSize: '13px',
            minHeight: '110px', resize: 'vertical', boxSizing: 'border-box', outline: 'none',
        },
        fieldSelect: {
            width: '100%',
            background: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(0,0,0,0.14)', borderRadius: '10px',
            color: 'var(--text-primary)', padding: '8px 11px',
            fontFamily: 'var(--font-ui)', fontSize: '13px',
        },
        webhookBox: {
            background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: '8px',
            padding: '7px 10px', fontSize: '10px', color: 'var(--text-muted)',
            marginBottom: '8px', wordBreak: 'break-all', cursor: 'pointer',
        },
    }

    return (
        <div style={s.container}>
            {/* Sidebar */}
            <div style={s.sidebar}>
                <div style={s.sidebarHeader}>
                    <span style={s.sidebarTitle}>✉️ Threads</span>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <button className="btn btn-sky btn-xs" onClick={() => setShowManual(true)}>+ Email</button>
                        <button className="btn btn-primary btn-xs" onClick={() => setShowWizard(true)} title="Start a new outbound negotiation">⚡ Start</button>
                    </div>
                </div>
                <div style={s.threadList}>
                    {threads.length === 0 && (
                        <div style={{ ...s.empty, marginTop: '30px', fontSize: '11px' }}>No threads yet.<br />Paste an email to start.</div>
                    )}
                    {threads.map(t => {
                        const hasScheduled = false // could check emails table but keeps it simple
                        return (
                            <div key={t.id} style={s.threadItem(selectedThread?.id === t.id)} onClick={() => selectThread(t)}>
                                <div style={s.threadFrom}>{t.counterparty_email}</div>
                                <div style={s.threadSubject}>{t.subject || '(no subject)'}</div>
                                <div style={{ display: 'flex', gap: '6px', marginTop: '3px', fontSize: '10px', alignItems: 'center' }}>
                                    <span className={`dot dot-${t.status === 'active' ? 'green' : 'muted'}`} />
                                    <span style={{ color: 'var(--text-muted)', fontWeight: '500' }}>{t.status}</span>
                                    <span style={{ color: 'var(--border-mid)' }}>·</span>
                                    <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{t.mode}</span>
                                    {t.counterparty_intel && Object.keys(t.counterparty_intel).length > 0 && (
                                        <span title="Intel gathered" style={{ color: '#38bdf8' }}>🔍</span>
                                    )}
                                    {t.thread_state?.escalation_level > 2 && (
                                        <span title={`Escalation level ${t.thread_state.escalation_level}`} style={{ color: '#f97316' }}>🔥</span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
                {/* Webhook info */}
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-subtle)', fontSize: '10px', color: 'var(--text-muted)' }}>
                    <div style={{ marginBottom: '4px', fontWeight: '600', letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '9px' }}>Postmark Webhook</div>
                    <div style={s.webhookBox} onClick={() => navigator.clipboard?.writeText(WEBHOOK_URL)} title="Click to copy">
                        {WEBHOOK_URL}
                    </div>
                </div>
            </div>

            {/* Main */}
            <div style={s.main}>
                {!selectedThread ? (
                    <div style={s.empty}>Select a thread or paste an email to begin</div>
                ) : (
                    <>
                        {/* Position Brief Card — shown when AI has drafted but user hasn't confirmed */}
                        {selectedThread?.our_position && !selectedThread?.position_confirmed && !briefDismissed[selectedThread.id] && (
                            <PositionBriefCard
                                thread={selectedThread}
                                onConfirm={handleConfirmPosition}
                                onDismiss={handleDismissBrief}
                            />
                        )}
                        <div style={s.mainHeader}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: '600' }}>{selectedThread.subject}</div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => setShowOutcome(true)} className="btn btn-green btn-xs">🏁 Close</button>
                                    <button onClick={handleToggleMode} className={`btn btn-xs ${selectedThread.mode === 'autonomous' ? 'btn-primary' : 'btn-ghost'}`}>
                                        {selectedThread.mode === 'autonomous' ? '🤖 Auto' : '👁 Coached'}
                                    </button>
                                </div>
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '3px' }}>{selectedThread.counterparty_email} <span style={{ color: 'var(--border-strong)' }}>·</span> {selectedThread.domain}</div>
                        </div>
                        {showOutcome && (
                            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)' }}>
                                <form onSubmit={handleMarkOutcome} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', borderRadius: '14px', padding: '26px', width: '400px', boxShadow: 'var(--shadow-panel)' }}>
                                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '6px' }}>🏁 Close This Negotiation</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '18px' }}>Claude will analyze the thread and extract lessons to your Knowledge Library.</div>
                                    <label style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>Outcome</label>
                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                                        {['win', 'partial', 'loss'].map(o => (
                                            <button type="button" key={o} onClick={() => setOutcome(v => ({ ...v, outcome: o }))} style={{
                                                flex: 1, padding: '8px', border: `1px solid ${outcome.outcome === o ? (o === 'win' ? '#10b981' : o === 'partial' ? '#f59e0b' : '#ef4444') : '#1e293b'}`,
                                                background: outcome.outcome === o ? (o === 'win' ? '#064e3b' : o === 'partial' ? '#431407' : '#450a0a') : '#0f172a',
                                                color: o === 'win' ? '#6ee7b7' : o === 'partial' ? '#fcd34d' : '#fca5a5',
                                                cursor: 'pointer', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                                            }}>{o === 'win' ? '🏆 Win' : o === 'partial' ? '🤝 Partial' : '❌ Loss'}</button>
                                        ))}
                                    </div>
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Deal Value (optional)</label>
                                    <input value={outcome.deal_value} onChange={e => setOutcome(v => ({ ...v, deal_value: e.target.value }))} placeholder="e.g. 450000"
                                        style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px', color: '#f1f5f9', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }} />
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Notes (optional)</label>
                                    <textarea value={outcome.notes} onChange={e => setOutcome(v => ({ ...v, notes: e.target.value }))} rows={3}
                                        placeholder="What happened? What was the key turning point?"
                                        style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px', color: '#f1f5f9', fontSize: '13px', marginBottom: '16px', resize: 'vertical', boxSizing: 'border-box' }} />
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button type="submit" disabled={reflectLoading} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                                            {reflectLoading ? 'Analyzing…' : '✨ Extract Lessons'}
                                        </button>
                                        <button type="button" onClick={() => setShowOutcome(false)} style={{ padding: '10px 16px', background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
                                    </div>
                                </form>
                            </div>
                        )}

                        <div style={s.emailList}>
                            {emails.map(email => (
                                <div key={email.id} style={{ display: 'flex', flexDirection: 'column', alignItems: email.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                                    <div style={s.emailBubble(email.direction)}>
                                        <div style={s.emailMeta}>{email.direction === 'inbound' ? '← THEM' : '→ US'} · {new Date(email.created_at).toLocaleString()} · <span style={{ color: STATUS_COLORS[email.status] || '#64748b' }}>{email.status}</span></div>
                                        <div style={s.emailBody}>{email.body}</div>
                                        {email.direction === 'inbound' && email.claude_analysis && (
                                            <div style={s.analysisCard}>
                                                {email.claude_analysis.psychological_read && (
                                                    <div style={{ marginBottom: '6px', padding: '6px 8px', background: '#1e1b4b', border: '1px solid #312e81', borderLeft: '2px solid #7c3aed' }}>
                                                        <div style={{ fontSize: '10px', color: '#a5b4fc', fontWeight: 'bold', marginBottom: '3px' }}>🧠 PSYCH READ</div>
                                                        {email.claude_analysis.psychological_read.personality_type && (
                                                            <div style={{ fontSize: '10px', color: '#c4b5fd', marginBottom: '2px' }}>Personality: {email.claude_analysis.psychological_read.personality_type}</div>
                                                        )}
                                                        {email.claude_analysis.psychological_read.target_emotional_state && (
                                                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Target state: {email.claude_analysis.psychological_read.target_emotional_state}</div>
                                                        )}
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                    {email.claude_analysis.technique_detected && <span style={s.analysisPill}>🎯 {email.claude_analysis.technique_detected}</span>}
                                                    {email.claude_analysis.technique_applied && <span style={s.analysisPill}>⚡ {email.claude_analysis.technique_applied}</span>}
                                                    {email.claude_analysis.bluff_probability !== undefined && <span style={s.analysisPill}>🎲 Bluff: {Math.round(email.claude_analysis.bluff_probability * 100)}%</span>}
                                                </div>
                                                {email.claude_analysis.chess_position && (
                                                    <div style={{ marginBottom: '4px', padding: '4px 8px', background: '#0f2b1e', border: '1px solid #14532d', fontSize: '10px', color: '#86efac' }}>
                                                        ♟️ {email.claude_analysis.chess_position}
                                                    </div>
                                                )}
                                                {email.claude_analysis.internal_reasoning && (
                                                    <div style={{ color: '#64748b', marginTop: '4px', fontSize: '10px' }}>{email.claude_analysis.internal_reasoning}</div>
                                                )}
                                                {email.claude_analysis.leverage_assessment && (
                                                    <div style={{ marginTop: '6px', background: '#0f172a', border: '1px solid #1e3a5f', padding: '6px 8px', fontSize: '10px' }}>
                                                        <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>⚖️ LEVERAGE: </span>
                                                        <span style={{ color: '#94a3b8' }}>{email.claude_analysis.leverage_assessment}</span>
                                                    </div>
                                                )}
                                                {email.claude_analysis.next_move_prediction && (
                                                    <div style={{ marginTop: '4px', background: '#0f172a', border: '1px solid #1e293b', padding: '6px 8px', fontSize: '10px' }}>
                                                        <span style={{ color: '#a5b4fc', fontWeight: 'bold' }}>🔮 PREDICT: </span>
                                                        <span style={{ color: '#94a3b8' }}>{email.claude_analysis.next_move_prediction}</span>
                                                    </div>
                                                )}
                                                {email.claude_analysis.contract_analysis?.length > 0 && (
                                                    <div style={{ marginTop: '10px', borderTop: '1px solid #1e293b', paddingTop: '8px' }}>
                                                        <div style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 'bold', marginBottom: '6px' }}>📄 CONTRACT ANALYSIS</div>
                                                        {email.claude_analysis.contract_analysis.map((item, i) => (
                                                            <div key={i} style={{ marginBottom: '10px', background: '#0a0f1e', border: `1px solid ${item.risk === 'high' ? '#ef4444' : item.risk === 'medium' ? '#f59e0b' : '#22c55e'}`, padding: '8px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                                                    <span style={{ fontSize: '10px', background: item.risk === 'high' ? '#ef4444' : item.risk === 'medium' ? '#f59e0b' : '#22c55e', color: '#000', padding: '1px 6px', fontWeight: 'bold' }}>{item.risk?.toUpperCase()}</span>
                                                                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{item.issue}</span>
                                                                </div>
                                                                <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginBottom: '4px' }}>"{item.clause?.slice(0, 120)}{item.clause?.length > 120 ? '...' : ''}"</div>
                                                                {item.redline && (
                                                                    <div style={{ fontSize: '10px', color: '#86efac', background: '#052e16', padding: '4px 6px', borderLeft: '2px solid #22c55e' }}>
                                                                        ✏️ Redline: {item.redline}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Draft panel */}
                        {pendingEmail && (
                            <div style={s.draftPanel}>
                                {/* Scheduled send timing bar */}
                                {scheduledTime && (
                                    <div style={{ marginBottom: '8px', padding: '8px 10px', background: '#0c1929', border: '1px solid #0ea5e9', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '11px', color: '#38bdf8' }}>📅 Scheduled:</span>
                                        <span style={{ fontSize: '11px', color: '#e2e8f0', flex: 1 }}>{scheduledDisplay || formatScheduledTime(scheduledTime)}</span>
                                        <button
                                            onClick={() => setShowTimingReason(v => !v)}
                                            style={{ fontSize: '10px', background: 'transparent', border: '1px solid #0ea5e966', color: '#38bdf8', padding: '2px 6px', cursor: 'pointer' }}
                                        >Why?</button>
                                    </div>
                                )}
                                {showTimingReason && timingReason && (
                                    <div style={{ marginBottom: '8px', padding: '6px 10px', background: '#060d1a', border: '1px solid #0f2744', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>
                                        {timingReason}
                                    </div>
                                )}
                                <div style={s.draftLabel}>CLAUDE DRAFT REPLY — edit before sending:</div>
                                <textarea
                                    style={s.draftTextarea}
                                    value={draftEdit}
                                    onChange={e => setDraftEdit(e.target.value)}
                                />
                                <div style={s.btnRow}>
                                    <button className="btn btn-primary btn-sm" onClick={handleApproveAndSend} disabled={sending}>
                                        {sending ? '⟳ Sending...' : '📤 Send Now'}
                                    </button>
                                    {scheduledTime && (
                                        <button className="btn btn-sky btn-sm" onClick={handleConfirmSchedule}>✅ Keep Schedule</button>
                                    )}
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {[2, 4, 24].map(h => (
                                            <button key={h} className="btn btn-ghost btn-xs" onClick={() => handleReschedule(h)}>+{h}h</button>
                                        ))}
                                    </div>
                                    <button className="btn btn-ghost btn-sm" onClick={handleSkip}>Skip</button>
                                    <span style={s.logMsg}>{log}</span>
                                </div>
                            </div>
                        )}
                        {!pendingEmail && (
                            <div style={{ padding: '10px 16px', borderTop: '1px solid #1e293b', color: '#475569', fontSize: '12px' }}>
                                {log || 'No pending reply — all responses handled.'}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Intelligence Dashboard — right panel */}
            <IntelligenceDashboard thread={selectedThread} />

            {/* Manual email modal */}
            {showManual && (
                <div style={s.modal}>
                    <div style={s.modalBox}>
                        <div style={s.modalTitle}>✉️ PASTE INCOMING EMAIL</div>
                        <div style={s.field}>
                            <label style={s.fieldLabel}>From (their email)</label>
                            <input style={s.fieldInput} value={manual.from} onChange={e => setManual(p => ({ ...p, from: e.target.value }))} placeholder="counterparty@example.com" />
                        </div>
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Subject</label>
                            <input style={s.fieldInput} value={manual.subject} onChange={e => setManual(p => ({ ...p, subject: e.target.value }))} placeholder="Re: Negotiation" />
                        </div>
                        <div style={s.field}>
                            <label style={s.fieldLabel}>Email body</label>
                            <textarea style={s.fieldTextarea} value={manual.body} onChange={e => setManual(p => ({ ...p, body: e.target.value }))} placeholder="Paste the email text here..." />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div style={s.field}>
                                <label style={s.fieldLabel}>Domain / Context</label>
                                <input style={s.fieldInput} value={manual.domain} onChange={e => setManual(p => ({ ...p, domain: e.target.value }))} />
                            </div>
                            <div style={s.field}>
                                <label style={s.fieldLabel}>Mode</label>
                                <select style={s.fieldSelect} value={manual.mode} onChange={e => setManual(p => ({ ...p, mode: e.target.value }))}>
                                    <option value="coached">Coached (review before send)</option>
                                    <option value="autonomous">Autonomous (auto-send)</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button style={s.sendBtn} onClick={handleManualSubmit} disabled={loading || !manual.from || !manual.body}>
                                {loading ? '⟳ Processing...' : '⚡ Analyze & Draft Reply'}
                            </button>
                            <button style={s.skipBtn} onClick={() => setShowManual(false)}>Cancel</button>
                        </div>
                        {log && <div style={{ marginTop: '8px', color: '#94a3b8', fontSize: '12px' }}>{log}</div>}
                    </div>
                </div>
            )}

            {/* Start Negotiation Wizard */}
            {showWizard && (
                <StartNegotiationWizard
                    onClose={() => setShowWizard(false)}
                    onCreated={async (newThreadId) => {
                        setShowWizard(false)
                        await loadThreads()
                        const { data: t } = await supabase.from('email_threads').select('*').eq('id', newThreadId).single()
                        if (t) await selectThread(t)
                    }}
                />
            )}
        </div>
    )
}
