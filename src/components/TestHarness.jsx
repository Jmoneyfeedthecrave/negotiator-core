/**
 * TestHarness.jsx
 * Phase 1 barebones test UI — intentionally unstyled.
 * Allows manual testing of the full backend pipeline on Netlify before Phase 3 UI is built.
 * Shows: domain input, BATNA input, counterparty message, mode toggle, send button, raw log.
 */

import { useState, useRef } from 'react'
import { initSession, runNegotiationTurn, endSession } from '../api/claudeClient.js'

const LOG_TYPES = {
    info: { prefix: '[INFO]', color: '#93c5fd' },
    success: { prefix: '[OK]', color: '#86efac' },
    error: { prefix: '[ERROR]', color: '#f87171' },
    batna: { prefix: '[BATNA BREACH]', color: '#f97316' },
    turn: { prefix: '[TURN]', color: '#e2e8f0' },
    warning: { prefix: '[WARN]', color: '#fbbf24' },
}

export default function TestHarness() {
    const [sessionId, setSessionId] = useState(null)
    const [domain, setDomain] = useState('Real Estate Negotiation')
    const [batnaValue, setBatnaValue] = useState(500000)
    const [batnaDesc, setBatnaDesc] = useState('Minimum acceptable sale price')
    const [concessionBudget, setConcessionBudget] = useState(20)
    const [mode, setMode] = useState('coached')
    const [message, setMessage] = useState('')
    const [log, setLog] = useState([])
    const [loading, setLoading] = useState(false)
    const [pendingResponse, setPendingResponse] = useState(null)
    const logRef = useRef(null)

    function addLog(type, content) {
        const { prefix, color } = LOG_TYPES[type] || LOG_TYPES.info
        const entry = {
            id: Date.now() + Math.random(),
            prefix,
            color,
            content: typeof content === 'object' ? JSON.stringify(content, null, 2) : content,
            timestamp: new Date().toLocaleTimeString(),
        }
        setLog((prev) => {
            const next = [...prev, entry]
            // auto-scroll
            setTimeout(() => {
                logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
            }, 50)
            return next
        })
    }

    async function handleInitSession() {
        setLoading(true)
        try {
            addLog('info', `Initializing session — domain: "${domain}", BATNA: ${batnaValue}`)
            const result = await initSession({
                domain,
                configId: null, // No saved config for test harness — uses inline defaults
            })
            setSessionId(result.session_id)
            addLog('success', `Session created. session_id: ${result.session_id}`)
        } catch (err) {
            addLog('error', err.message)
        } finally {
            setLoading(false)
        }
    }

    async function handleSendTurn() {
        if (!sessionId) {
            addLog('error', 'No active session. Click "Initialize Session" first.')
            return
        }
        if (!message.trim()) {
            addLog('warning', 'Enter a counterparty message before sending.')
            return
        }
        setLoading(true)
        setPendingResponse(null)

        addLog('info', `[COUNTERPARTY → US] "${message}"`)

        try {
            const result = await runNegotiationTurn({
                sessionId,
                counterpartyMessage: message,
                mode,
            })

            if (result.type === 'batna_breach') {
                addLog('batna', result.reason)
                return
            }

            addLog('turn', {
                turn: result.turn_number,
                mode: result.type,
                technique_detected: result.technique_detected,
                technique_applied: result.technique_applied,
                move: result.move,
                confidence: result.confidence_score,
                concession_remaining: result.concession_remaining,
            })

            addLog('info', `[INTERNAL REASONING]\n${result.internal_reasoning}`)
            addLog('info', `[BAYESIAN UPDATE]\n${result.bayesian_update_notes}`)

            if (result.bluff_probability_updates?.length) {
                addLog('info', `[BLUFF TRACKER] ${JSON.stringify(result.bluff_probability_updates, null, 2)}`)
            }

            if (mode === 'coached') {
                setPendingResponse(result.natural_language_response)
                addLog('warning', `[COACHED MODE — PENDING APPROVAL]\n"${result.natural_language_response}"\n\nClick "Approve & Send" to dispatch, or edit and resend.`)
            } else {
                addLog('success', `[AUTONOMOUS RESPONSE SENT]\n"${result.natural_language_response}"`)
            }

            setMessage('')
        } catch (err) {
            addLog('error', err.message)
        } finally {
            setLoading(false)
        }
    }

    async function handleApprove() {
        addLog('success', `[COACHED RESPONSE APPROVED & DISPATCHED]\n"${pendingResponse}"`)
        setPendingResponse(null)
    }

    async function handleEndSession() {
        if (!sessionId) return
        setLoading(true)
        try {
            const result = await endSession({ sessionId, outcome: 'manual_end', finalValue: null })
            addLog('success', `Session ended. outcome: ${result.outcome}`)
            setSessionId(null)
            setPendingResponse(null)
        } catch (err) {
            addLog('error', err.message)
        } finally {
            setLoading(false)
        }
    }

    function handleClearLog() {
        setLog([])
    }

    const styles = {
        container: { padding: '16px', maxWidth: '900px', margin: '0 auto' },
        h1: { fontSize: '18px', marginBottom: '16px', color: '#94a3b8' },
        section: { marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
        label: { color: '#94a3b8', minWidth: '130px' },
        input: { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '4px 8px', fontFamily: 'monospace', flex: 1, minWidth: '200px' },
        textarea: { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', fontFamily: 'monospace', width: '100%', resize: 'vertical', minHeight: '60px' },
        btn: { background: '#1e40af', border: 'none', color: '#fff', padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace' },
        btnDanger: { background: '#7f1d1d', border: 'none', color: '#fff', padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace' },
        btnSuccess: { background: '#14532d', border: 'none', color: '#fff', padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace' },
        btnGray: { background: '#374151', border: 'none', color: '#fff', padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace' },
        select: { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '4px 8px', fontFamily: 'monospace' },
        status: { padding: '8px', background: '#0f172a', border: '1px solid #1e40af', marginBottom: '12px', color: '#93c5fd' },
        log: {
            background: '#0f172a', border: '1px solid #1e293b', padding: '10px',
            height: '420px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px',
        },
        logEntry: { marginBottom: '10px', borderBottom: '1px solid #1e293b', paddingBottom: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        divider: { borderTop: '1px solid #1e293b', margin: '12px 0' },
    }

    return (
        <div style={styles.container}>
            <h1 style={styles.h1}>⚡ NEGOTIATOR-CORE — PHASE 1 TEST HARNESS</h1>

            {/* Status bar */}
            <div style={styles.status}>
                {sessionId
                    ? `● ACTIVE SESSION: ${sessionId} | Mode: ${mode.toUpperCase()}`
                    : '○ NO ACTIVE SESSION — Initialize to begin'}
            </div>

            {/* Config */}
            <div style={styles.section}>
                <span style={styles.label}>Domain:</span>
                <input style={styles.input} value={domain} onChange={(e) => setDomain(e.target.value)} disabled={!!sessionId} />
            </div>
            <div style={styles.section}>
                <span style={styles.label}>BATNA Value:</span>
                <input style={styles.input} type="number" value={batnaValue} onChange={(e) => setBatnaValue(Number(e.target.value))} disabled={!!sessionId} />
                <input style={{ ...styles.input, minWidth: '260px' }} placeholder="BATNA description" value={batnaDesc} onChange={(e) => setBatnaDesc(e.target.value)} disabled={!!sessionId} />
            </div>
            <div style={styles.section}>
                <span style={styles.label}>Concession Budget:</span>
                <input style={{ ...styles.input, maxWidth: '80px' }} type="number" value={concessionBudget} onChange={(e) => setConcessionBudget(Number(e.target.value))} disabled={!!sessionId} />
                <span style={{ color: '#64748b' }}>%</span>
            </div>
            <div style={styles.section}>
                <span style={styles.label}>Mode:</span>
                <select style={styles.select} value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="coached">Coached (human approves before send)</option>
                    <option value="autonomous">Autonomous (sends directly)</option>
                </select>
            </div>

            {/* Session controls */}
            <div style={{ ...styles.section, marginBottom: '16px' }}>
                {!sessionId ? (
                    <button style={styles.btn} onClick={handleInitSession} disabled={loading}>
                        {loading ? 'Initializing...' : 'Initialize Session'}
                    </button>
                ) : (
                    <button style={styles.btnDanger} onClick={handleEndSession} disabled={loading}>
                        End Session
                    </button>
                )}
                <button style={styles.btnGray} onClick={handleClearLog}>Clear Log</button>
            </div>

            <div style={styles.divider} />

            {/* Message input */}
            <div style={{ marginBottom: '8px' }}>
                <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Counterparty Message:</div>
                <textarea
                    style={styles.textarea}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type what the counterparty just said..."
                    disabled={loading || !sessionId}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleSendTurn() }}
                />
            </div>
            <div style={{ ...styles.section, marginBottom: '16px' }}>
                <button style={styles.btn} onClick={handleSendTurn} disabled={loading || !sessionId || !message.trim()}>
                    {loading ? 'Processing...' : 'Send Turn  (Ctrl+Enter)'}
                </button>
                {pendingResponse && (
                    <button style={styles.btnSuccess} onClick={handleApprove}>
                        ✓ Approve &amp; Send Response
                    </button>
                )}
            </div>

            <div style={styles.divider} />

            {/* Log window */}
            <div style={{ color: '#64748b', marginBottom: '4px' }}>Turn Log:</div>
            <div style={styles.log} ref={logRef}>
                {log.length === 0 && (
                    <div style={{ color: '#374151' }}>Log is empty. Initialize a session and send turns to see output.</div>
                )}
                {log.map((entry) => (
                    <div key={entry.id} style={styles.logEntry}>
                        <span style={{ color: '#475569' }}>{entry.timestamp} </span>
                        <span style={{ color: entry.color, fontWeight: 'bold' }}>{entry.prefix} </span>
                        <span style={{ color: '#e2e8f0' }}>{entry.content}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
