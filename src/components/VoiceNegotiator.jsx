import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../api/supabaseClient.js'

const DOMAINS = ['Real Estate', 'Business Acquisition', 'SaaS / Software', 'Employment', 'Fundraising', 'Legal Settlement', 'Sales', 'General Business']

// ââ Formatting helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââ
function formatDuration(ms) {
    if (!ms) return 'â'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}
function scoreColor(n) {
    if (n >= 75) return '#22c55e'
    if (n >= 50) return '#f59e0b'
    return '#ef4444'
}
function emotionEmoji(e) {
    const map = { anger: 'ð ', fear: 'ð¨', joy: 'ð', sadness: 'ð', surprise: 'ð²', disgust: 'ð¤¢', contempt: 'ð', excitement: 'ð¤©', interest: 'â¹ï¸', confusion: 'ð', calmness: 'ð', boredom: 'ð´', stress: 'ð¤', relief: 'ð®âð¨' }
    return map[e?.toLowerCase()] || 'ðµ'
}

// ââ Voice Setup Wizard âââââââââââââââââââââââââââââââââââââââââââââââââââââ
function SetupWizard({ threads, onStart }) {
    const [step, setStep] = useState(1)
    const [form, setForm] = useState({
        counterparty_name: '',
        domain: 'Real Estate',
        thread_id: '',
        goal: '',
        ideal_outcome: '',
        walkaway: '',
        concessions_available: '',
        constraints: '',
        tone: 'professional',
    })
    const [loading, setLoading] = useState(false)

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

    async function handleStart() {
        setLoading(true)
        try {
            // Safe JSON parse â backend may return plain text on startup errors
            async function safeJson(res) {
                const text = await res.text()
                try { return JSON.parse(text) }
                catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 200)}`) }
            }

            // Create the voice session in DB
            const res = await fetch('/api/voice-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create',
                    title: `Call with ${form.counterparty_name}`,
                    counterparty_name: form.counterparty_name,
                    thread_id: form.thread_id || null,
                    our_position: {
                        goal: form.goal,
                        ideal_outcome: form.ideal_outcome,
                        walkaway: form.walkaway,
                        concessions_available: form.concessions_available,
                        constraints: form.constraints,
                        tone: form.tone,
                    },
                }),
            })
            const session = await safeJson(res)
            if (!res.ok) throw new Error(session.error || `voice-session error ${res.status}`)
            // Pass domain so ActiveCallPanel can build the system prompt
            onStart({ ...session, domain: form.domain })
        } catch (err) {
            alert('Setup failed: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const s = {
        overlay: {
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        box: {
            background: 'linear-gradient(160deg, #0d1117 0%, #111827 100%)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '20px',
            padding: '32px',
            width: '540px',
            maxWidth: '94vw',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        },
        label: {
            display: 'block', fontSize: '10px', fontWeight: '700',
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: '#64748b', marginBottom: '6px',
        },
        input: {
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px', color: '#f1f5f9',
            padding: '9px 13px',
            fontFamily: 'var(--font-ui)', fontSize: '13px', outline: 'none',
            transition: 'border-color 0.15s',
        },
    }

    return (
        <div style={s.overlay}>
            <div style={s.box}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>ðï¸</div>
                    <div>
                        <div style={{ fontSize: '17px', fontWeight: '800', color: '#f1f5f9' }}>ARCHI Voice Negotiation</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Step {step} of 2 â {step === 1 ? 'Counterparty & Context' : 'Your Position'}</div>
                    </div>
                </div>

                {step === 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <label style={s.label}>Counterparty Name *</label>
                            <input style={s.input} value={form.counterparty_name} onChange={e => set('counterparty_name', e.target.value)} placeholder="e.g. John Smith" autoFocus />
                        </div>
                        <div>
                            <label style={s.label}>Negotiation Domain</label>
                            <select style={{ ...s.input }} value={form.domain} onChange={e => set('domain', e.target.value)}>
                                {DOMAINS.map(d => <option key={d}>{d}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={s.label}>Link to Email Thread (optional â ARCHI will cross-reference)</label>
                            <select style={{ ...s.input }} value={form.thread_id} onChange={e => set('thread_id', e.target.value)}>
                                <option value="">No linked thread</option>
                                {threads.map(t => <option key={t.id} value={t.id}>{t.counterparty_email} â {t.subject}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={s.label}>Tone</label>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {['professional', 'warm & collaborative', 'firm & direct', 'aggressive'].map(t => (
                                    <button key={t} onClick={() => set('tone', t)} style={{
                                        padding: '6px 14px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                                        border: `1px solid ${form.tone === t ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                                        background: form.tone === t ? 'rgba(99,102,241,0.2)' : 'transparent',
                                        color: form.tone === t ? '#a5b4fc' : '#94a3b8',
                                    }}>{t}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                            <label style={s.label}>Your Goal *</label>
                            <input style={s.input} value={form.goal} onChange={e => set('goal', e.target.value)} placeholder="e.g. Sell my property for $850K" />
                        </div>
                        <div>
                            <label style={s.label}>Ideal Outcome</label>
                            <input style={s.input} value={form.ideal_outcome} onChange={e => set('ideal_outcome', e.target.value)} placeholder="e.g. $875K + 60-day close + furniture included" />
                        </div>
                        <div>
                            <label style={s.label}>Walk-Away Point (BATNA) â ARCHI will never go below this</label>
                            <input style={s.input} value={form.walkaway} onChange={e => set('walkaway', e.target.value)} placeholder="e.g. $800K â below this we list with another buyer" />
                        </div>
                        <div>
                            <label style={s.label}>Concessions Available (what you can give up)</label>
                            <input style={s.input} value={form.concessions_available} onChange={e => set('concessions_available', e.target.value)} placeholder="e.g. Closing date flexibility, appliance package, small price reduction" />
                        </div>
                        <div>
                            <label style={s.label}>Hard Constraints (never compromise)</label>
                            <input style={s.input} value={form.constraints} onChange={e => set('constraints', e.target.value)} placeholder="e.g. Must close before April 30" />
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                    {step === 1 ? (
                        <>
                            <button onClick={() => setStep(2)} disabled={!form.counterparty_name} style={{
                                flex: 1, padding: '12px', borderRadius: '12px', border: 'none',
                                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                                color: '#fff', fontWeight: '700', fontSize: '14px',
                                cursor: form.counterparty_name ? 'pointer' : 'not-allowed',
                                opacity: form.counterparty_name ? 1 : 0.5,
                                boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
                            }}>Next â</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setStep(1)} style={{
                                padding: '12px 20px', borderRadius: '12px', cursor: 'pointer',
                                border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
                                color: '#94a3b8', fontSize: '14px',
                            }}>â Back</button>
                            <button onClick={handleStart} disabled={loading || !form.goal} style={{
                                flex: 1, padding: '12px', borderRadius: '12px', border: 'none',
                                background: 'linear-gradient(135deg, #059669, #10b981)',
                                color: '#fff', fontWeight: '700', fontSize: '14px',
                                cursor: form.goal && !loading ? 'pointer' : 'not-allowed',
                                opacity: form.goal && !loading ? 1 : 0.5,
                                boxShadow: '0 4px 20px rgba(16,185,129,0.4)',
                            }}>
                                {loading ? 'â³ Configuring ARCHI...' : 'ðï¸ Launch Call'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

// ââ Active Call Panel â direct WebSocket + getUserMedia (no SDK) âââââââââââââ
function ActiveCallPanel({ session, onEnd }) {
    const [status, setStatus]         = useState('idle')
    const [transcript, setTranscript] = useState([])
    const [elapsedMs, setElapsedMs]   = useState(0)
    const [micError, setMicError]     = useState('')
    const [isMuted, setIsMuted]       = useState(false)

    const wsRef        = useRef(null)
    const streamRef    = useRef(null)
    const processorRef = useRef(null)
    const audioCtxRef  = useRef(null)
    const startRef     = useRef(null)
    const timerRef     = useRef(null)
    const audioQueueRef = useRef([])
    const playingRef   = useRef(false)
    const mutedRef     = useRef(false)

    async function playNext() {
        if (playingRef.current || audioQueueRef.current.length === 0) return
        playingRef.current = true
        const blob  = audioQueueRef.current.shift()
        const url   = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.onended = () => { URL.revokeObjectURL(url); playingRef.current = false; playNext() }
        audio.play().catch(() => { playingRef.current = false; playNext() })
    }

    const micStartedRef = useRef(false)

    async function handleConnect() {
        setMicError('')
        setStatus('connecting')
        micStartedRef.current = false

        // Track scheduled playback time for gapless PCM audio
        let nextPlayAt = 0

        function playPCMChunk(base64) {
            try {
                const bytes   = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
                const samples = new Int16Array(bytes.buffer)
                const ctx     = audioCtxRef.current
                if (!ctx) return
                const buf  = ctx.createBuffer(1, samples.length, 16000)
                const data = buf.getChannelData(0)
                for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768
                const src = ctx.createBufferSource()
                src.buffer = buf
                src.connect(ctx.destination)
                const startAt = Math.max(ctx.currentTime, nextPlayAt)
                src.start(startAt)
                nextPlayAt = startAt + buf.duration
            } catch (e) {
                console.warn('[el] audio decode error:', e)
            }
        }

        try {
            // Step 1 â Request mic
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            streamRef.current = stream

            // Step 2 â Get Hume access token
            const tokenRes  = await fetch('/api/elevenlabs-token')
            const tokenData = await tokenRes.json()
            if (!tokenData.signed_url) throw new Error(tokenData.error || 'ElevenLabs token fetch failed')

            // Step 3 â Build WS URL
            audioCtxRef.current = new AudioContext({ sampleRate: 16000 })
            const ws = new WebSocket(tokenData.signed_url)
            wsRef.current = ws

            // Helper: start mic streaming AFTER session_settings ack
            function startMicStreaming() {
                if (micStartedRef.current) return
                micStartedRef.current = true
                const source    = audioCtxRef.current.createMediaStreamSource(stream)
                const processor = audioCtx.createScriptProcessor(4096, 1, 1)
                processorRef.current = processor
                processor.onaudioprocess = (e) => {
                    if (ws.readyState !== WebSocket.OPEN || mutedRef.current) return
                    const pcm = e.inputBuffer.getChannelData(0)
                    const i16 = new Int16Array(pcm.length)
                    for (let i = 0; i < pcm.length; i++) i16[i] = Math.max(-32768, Math.min(32767, pcm[i] * 32768))
                    const bytes = new Uint8Array(i16.buffer)
                    let b64 = ''
                    for (let j = 0; j < bytes.length; j += 8192) {
                        b64 += String.fromCharCode(...bytes.subarray(j, j + 8192))
                    }
                    b64 = btoa(b64)
                    ws.send(JSON.stringify({ user_audio_chunk: btoa(b64) }))
                }
                source.connect(processor)
                processor.connect(audioCtxRef.current.destination)
                setStatus('live')
                startRef.current = Date.now()
                timerRef.current = setInterval(() => setElapsedMs(Date.now() - startRef.current), 1000)
            }

            ws.onopen = () => {
                console.log('[el] WebSocket opened â injecting context')

                // Inject negotiation position as persistent context (Hume EVI runtime API)
                // Note: system_prompt can only be set in the config, not via session_settings
                const pos = session.our_position || {}
                const contextLines = [
                    `LIVE NEGOTIATION CONTEXT:`,
                    `Counterparty: ${session.counterparty_name || 'Unknown'}`,
                    pos.goal               ? `Our goal: ${pos.goal}` : '',
                    pos.ideal_outcome      ? `Ideal outcome: ${pos.ideal_outcome}` : '',
                    pos.walkaway           ? `Walk-away BATNA: ${pos.walkaway}` : '',
                    pos.concessions_available ? `Concessions available: ${pos.concessions_available}` : '',
                    pos.constraints        ? `Hard constraints: ${pos.constraints}` : '',
                    pos.tone               ? `Desired tone: ${pos.tone}` : '',
                ].filter(Boolean).join('\n')

                ws.send(JSON.stringify({
                    type: 'conversation_initiation_client_data',
                    conversation_config_override: {
                        agent: {
                            prompt: { prompt: contextLines },
                        },
                    },
                }))
                console.log('[el] context injected:', contextLines.slice(0, 120))

                startMicStreaming()
            }

            ws.onmessage = (evt) => {
                try {
                    const msg = JSON.parse(evt.data)

                    // Respond to keepalive pings -- required to maintain connection
                    if (msg.type === 'ping') {
                        ws.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id }))
                        return
                    }

                    // Agent audio -- PCM 16kHz, scheduled for gapless playback
                    if (msg.type === 'audio' && msg.audio_event?.audio_base_64) {
                        playPCMChunk(msg.audio_event.audio_base_64)
                    }

                    // Counterparty speech -> transcript
                    if (msg.type === 'user_transcript') {
                        const text = msg.user_transcription_event?.user_transcript
                        if (text) setTranscript(t => [...t, {
                            role: 'counterparty', content: text, emotions: {},
                            ts_ms: startRef.current ? Date.now() - startRef.current : 0,
                        }])
                    }

                    // ARCHI response -> transcript
                    if (msg.type === 'agent_response') {
                        const text = msg.agent_response_event?.agent_response
                        if (text) setTranscript(t => [...t, {
                            role: 'archi', content: text, emotions: {},
                            ts_ms: startRef.current ? Date.now() - startRef.current : 0,
                        }])
                    }

                    if (msg.type === 'error') {
                        console.error('[el] error:', JSON.stringify(msg))
                        setMicError('ElevenLabs: ' + (msg.message || JSON.stringify(msg)))
                    }
                } catch (e) { console.warn('[el] parse error:', e) }
            }

            ws.onerror = (e) => { console.error('[el] ws error:', e); setMicError('WebSocket connection failed.') }
            ws.onclose = (e) => { console.log('[el] ws closed:', e.code, e.reason); setStatus('idle') }
        } catch (err) {
            setStatus('idle')
            setMicError(err.name === 'NotAllowedError'
                ? 'Microphone access denied. Allow mic access in browser settings and try again.'
                : 'Connection failed: ' + err.message)
        }
    }

    function toggleMute() { const n = !isMuted; setIsMuted(n); mutedRef.current = n }

    async function handleEnd() {
        setStatus('ending')
        clearInterval(timerRef.current)
        processorRef.current?.disconnect()
        audioCtxRef.current?.close()
        streamRef.current?.getTracks().forEach(t => t.stop())
        wsRef.current?.close()
        const duration = startRef.current ? Date.now() - startRef.current : 0
        await fetch('/api/voice-session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', session_id: session.id, transcript: transcript.map(t => ({ role: t.role === 'archi' ? 'assistant' : 'user', content: t.content, emotions: t.emotions, ts_ms: t.ts_ms })), status: 'ended', duration_ms: duration }),
        })
        onEnd({ ...session, duration_ms: duration, transcript, status: 'ended' })
    }

    useEffect(() => () => { clearInterval(timerRef.current); processorRef.current?.disconnect(); audioCtxRef.current?.close(); streamRef.current?.getTracks().forEach(t => t.stop()); wsRef.current?.close() }, [])

    const isLive = status === 'live'
    const s = {
        container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#060d1a' },
        header:    { padding: '16px 20px', background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        area:      { flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' },
        turn: (r) => ({ maxWidth: '70%', alignSelf: r === 'archi' ? 'flex-end' : 'flex-start', background: r === 'archi' ? 'linear-gradient(135deg,#312e81,#4338ca)' : 'rgba(255,255,255,0.06)', border: `1px solid ${r === 'archi' ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: r === 'archi' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '10px 14px', fontSize: '13px', color: '#f1f5f9', lineHeight: 1.6 }),
        cta:       { padding: '24px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' },
    }

    return (
        <div style={s.container}>
            <div style={s.header}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: isLive ? '#ef4444' : '#475569', boxShadow: isLive ? '0 0 12px #ef444480' : 'none', transition: 'all 0.3s' }} />
                    <span style={{ color: '#f1f5f9', fontWeight: '700', fontSize: '14px' }}>{isLive ? `LIVE â ${session.counterparty_name}` : status === 'connecting' ? 'Connecting...' : `Ready â ${session.counterparty_name}`}</span>
                    {isLive && <span style={{ color: '#64748b', fontSize: '13px' }}>{formatDuration(elapsedMs)}</span>}
                </div>
                {isLive && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={toggleMute} style={{ padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', background: isMuted ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)', border: isMuted ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.1)', color: isMuted ? '#fca5a5' : '#94a3b8' }}>{isMuted ? 'ð Muted' : 'ðï¸ Mute'}</button>
                        <button onClick={handleEnd} style={{ padding: '8px 20px', borderRadius: '10px', cursor: 'pointer', background: 'linear-gradient(135deg,#dc2626,#991b1b)', border: 'none', color: '#fff', fontWeight: '700', fontSize: '13px', boxShadow: '0 2px 12px rgba(220,38,38,0.4)' }}>â¬ End Call</button>
                    </div>
                )}
            </div>
            <div style={s.area}>
                {transcript.length === 0 && <div style={{ textAlign: 'center', marginTop: '60px' }}><div style={{ fontSize: '32px', marginBottom: '12px' }}>ðï¸</div><div style={{ fontSize: '14px', color: '#475569' }}>{isLive ? 'ARCHI is listening. Speak now...' : 'Click Connect Microphone to start.'}</div></div>}
                {transcript.map((t, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: t.role === 'archi' ? 'flex-end' : 'flex-start' }}>
                        <div style={{ fontSize: '10px', color: '#475569', marginBottom: '3px', fontWeight: '600' }}>{t.role === 'archi' ? 'ð¤ ARCHI' : `ð¤ ${session.counterparty_name}`}</div>
                        <div style={s.turn(t.role)}>{t.content}</div>
                    </div>
                ))}
            </div>
            {!isLive && status !== 'connecting' && (
                <div style={s.cta}>
                    {micError && <div style={{ fontSize: '12px', color: '#f87171', textAlign: 'center', maxWidth: '420px' }}>{micError}</div>}
                    <button onClick={handleConnect} style={{ padding: '14px 36px', borderRadius: '14px', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', fontWeight: '700', fontSize: '15px', boxShadow: '0 4px 24px rgba(99,102,241,0.5)' }}>ðï¸ Connect Microphone</button>
                    <div style={{ fontSize: '11px', color: '#475569' }}>Browser will ask for mic permission â click Allow</div>
                </div>
            )}
            {status === 'connecting' && <div style={{ ...s.cta, color: '#94a3b8', fontSize: '13px' }}>Connecting to ARCHI...</div>}
        </div>
    )
}



// ââ Debrief Panel ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function DebriefPanel({ session, onAnalyze }) {
    const [loading, setLoading] = useState(false)
    const [log, setLog] = useState('')

    async function runAnalysis() {
        setLoading(true)
        setLog('Claude is analyzing the call...')
        try {
            const res = await fetch('/api/voice-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'analyze', session_id: session.id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setLog(`â ${data.lessons_extracted} lessons extracted`)
            onAnalyze(data.analysis)
        } catch (err) {
            setLog('â ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const a = session.analysis

    const s = {
        container: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px', overflowY: 'auto', height: '100%' },
        card: {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px', padding: '16px',
        },
        sectionTitle: { fontSize: '10px', fontWeight: '700', letterSpacing: '0.10em', textTransform: 'uppercase', color: '#475569', marginBottom: '10px' },
    }

    return (
        <div style={s.container}>
            {/* Score */}
            {a ? (
                <>
                    <div style={{ ...s.card, background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '44px', fontWeight: '900', color: scoreColor(a.negotiation_score), lineHeight: 1 }}>{a.negotiation_score}</div>
                            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>SCORE</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', marginBottom: '4px', textTransform: 'capitalize' }}>
                                {a.outcome_assessment === 'win' ? 'ð Win' : a.outcome_assessment === 'partial' ? 'ð¤ Partial' : a.outcome_assessment === 'ongoing' ? 'â³ Ongoing' : 'â Loss'}
                            </div>
                            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Duration: {formatDuration(session.duration_ms)}</div>
                            <div style={{ fontSize: '12px', color: '#86efac', marginTop: '4px' }}>â {a.what_to_do_next}</div>
                        </div>
                    </div>

                    {a.email_contradictions?.length > 0 && (
                        <div style={{ ...s.card, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
                            <div style={{ ...s.sectionTitle, color: '#ef4444' }}>â ï¸ CROSS-CHANNEL CONTRADICTIONS</div>
                            {a.email_contradictions.map((c, i) => (
                                <div key={i} style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: i < a.email_contradictions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                    <div style={{ fontSize: '11px', color: '#fca5a5', marginBottom: '3px' }}>ð§ In email: <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{c.they_said_in_email}</span></div>
                                    <div style={{ fontSize: '11px', color: '#fca5a5', marginBottom: '4px' }}>ðï¸ On call: <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{c.they_said_on_call}</span></div>
                                    <div style={{ display: 'inline-block', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', padding: '2px 8px', borderRadius: '99px', fontSize: '10px', color: '#fca5a5' }}>
                                        Bluff probability: {Math.round((c.bluff_probability || 0) * 100)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {a.emotion_insights?.length > 0 && (
                        <div style={s.card}>
                            <div style={s.sectionTitle}>ð§  Emotion Intelligence</div>
                            {a.emotion_insights.map((e, i) => (
                                <div key={i} style={{ marginBottom: '8px', fontSize: '12px' }}>
                                    <span style={{ color: '#a5b4fc' }}>{e.insight}</span>
                                    <span style={{ color: '#475569' }}> â </span>
                                    <span style={{ color: '#94a3b8' }}>{e.implication}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={s.card}>
                        <div style={s.sectionTitle}>ð¯ Techniques Detected</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                            {(a.techniques_they_used || []).map((t, i) => (
                                <span key={i} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', padding: '2px 10px', borderRadius: '99px', fontSize: '11px' }}>ð¤ {t}</span>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {(a.techniques_archi_used || []).map((t, i) => (
                                <span key={i} style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc', padding: '2px 10px', borderRadius: '99px', fontSize: '11px' }}>ð¤ {t}</span>
                            ))}
                        </div>
                    </div>

                    {a.key_moments?.length > 0 && (
                        <div style={s.card}>
                            <div style={s.sectionTitle}>â¡ Key Moments</div>
                            {a.key_moments.map((m, i) => (
                                <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'flex-start' }}>
                                    <span style={{ color: '#4b5563', fontSize: '10px', minWidth: '32px', paddingTop: '2px' }}>{m.timestamp_s}s</span>
                                    <div>
                                        <div style={{ fontSize: '12px', color: '#f1f5f9' }}>{m.moment}</div>
                                        <div style={{ fontSize: '11px', color: '#64748b' }}>{m.significance}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={s.card}>
                        <div style={s.sectionTitle}>â What Worked</div>
                        <div style={{ fontSize: '13px', color: '#86efac' }}>{a.what_worked}</div>
                    </div>
                </>
            ) : (
                <div style={s.card}>
                    <div style={{ textAlign: 'center', padding: '30px 0' }}>
                        <div style={{ fontSize: '32px', marginBottom: '12px' }}>ð</div>
                        <div style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '16px' }}>
                            Call ended. Duration: <strong style={{ color: '#f1f5f9' }}>{formatDuration(session.duration_ms)}</strong>
                        </div>
                        <button onClick={runAnalysis} disabled={loading} style={{
                            padding: '12px 28px', borderRadius: '12px', border: 'none',
                            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                            color: '#fff', fontWeight: '700', fontSize: '14px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
                        }}>
                            {loading ? 'â³ Analyzing...' : 'â¨ Generate Full Debrief'}
                        </button>
                        {log && <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>{log}</div>}
                    </div>
                </div>
            )}
        </div>
    )
}

// ââ Main Component âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default function VoiceNegotiator() {
    const [sessions, setSessions] = useState([])
    const [selectedSession, setSelectedSession] = useState(null)
    const [showSetup, setShowSetup] = useState(false)
    const [threads, setThreads] = useState([])
    const [activeCallSession, setActiveCallSession] = useState(null)

    const loadSessions = useCallback(async () => {
        const res = await fetch('/api/voice-session?all=true')
        const data = await res.json()
        setSessions(Array.isArray(data) ? data : [])
    }, [])

    useEffect(() => {
        loadSessions()
        supabase.from('email_threads').select('id, counterparty_email, subject').then(({ data }) => setThreads(data || []))
    }, [loadSessions])

    function handleCallStarted(session) {
        setShowSetup(false)
        setActiveCallSession(session)
        setSessions(s => [session, ...s])
        setSelectedSession(session)
    }

    function handleCallEnded(endedSession) {
        setActiveCallSession(null)
        setSelectedSession(endedSession)
        loadSessions()
    }

    function handleAnalyzed(analysis) {
        setSelectedSession(s => ({ ...s, analysis, status: 'analyzed' }))
        loadSessions()
    }

    const statusDot = (status) => {
        const map = { setup: '#94a3b8', active: '#ef4444', ended: '#f59e0b', analyzed: '#22c55e' }
        return map[status] || '#475569'
    }

    const s = {
        container: { display: 'flex', height: 'calc(100vh - 48px)', fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', background: '#060d1a' },
        sidebar: { width: '260px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)' },
        sidebarHeader: { padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        sessionItem: (selected) => ({
            padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            cursor: 'pointer', transition: 'all 0.15s',
            background: selected ? 'rgba(99,102,241,0.1)' : 'transparent',
            borderLeft: `3px solid ${selected ? '#6366f1' : 'transparent'}`,
        }),
        main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    }

    return (
        <div style={s.container}>
            {showSetup && (
                <SetupWizard threads={threads} onStart={handleCallStarted} />
            )}

            {/* Sidebar */}
            <div style={s.sidebar}>
                <div style={s.sidebarHeader}>
                    <span style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '0.10em', textTransform: 'uppercase', color: '#475569' }}>Voice Sessions</span>
                    <button onClick={() => setShowSetup(true)} className="btn btn-primary btn-xs">+ New Call</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {sessions.length === 0 && (
                        <div style={{ padding: '40px 16px', textAlign: 'center', color: '#334155', fontSize: '12px' }}>
                            No voice sessions yet.<br />Start your first call.
                        </div>
                    )}
                    {sessions.map(sess => (
                        <div key={sess.id} style={s.sessionItem?.(selectedSession?.id === sess.id)} onClick={() => setSelectedSession(sess)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: statusDot(sess.status), flexShrink: 0 }} />
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.counterparty_name || 'Unknown'}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#475569', paddingLeft: '14px' }}>
                                {sess.status} Â· {formatDuration(sess.duration_ms)} Â· {sess.lessons_extracted > 0 ? `${sess.lessons_extracted} lessons` : ''}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main content */}
            <div style={s.main}>
                {(() => {
                    // No hume_config_id needed â session_settings injected via WebSocket
                    const callSession = activeCallSession && activeCallSession.id === selectedSession?.id
                        ? activeCallSession
                        : (selectedSession?.status === 'setup' || selectedSession?.status === 'active')
                            ? selectedSession
                            : null

                    if (callSession) {
                        return <ActiveCallPanel session={callSession} onEnd={handleCallEnded} />
                    }
                    if (selectedSession && (selectedSession.status === 'ended' || selectedSession.status === 'analyzed')) {
                        return <DebriefPanel session={selectedSession} onAnalyze={handleAnalyzed} />
                    }
                    if (selectedSession) {
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>â³</div>
                                    <div style={{ fontSize: '14px' }}>Session is still setting up...</div>
                                    <div style={{ fontSize: '12px', marginTop: '6px', color: '#334155' }}>No Hume config found yet. Try starting a new call.</div>
                                </div>
                            </div>
                        )
                    }
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.4 }}>ðï¸</div>
                                <div style={{ fontSize: '18px', fontWeight: '700', color: '#f1f5f9', marginBottom: '8px' }}>ARCHI Voice Negotiations</div>
                                <div style={{ fontSize: '13px', color: '#475569', marginBottom: '24px', maxWidth: '380px' }}>
                                    ARCHI conducts live voice negotiations autonomously using Hume's emotion-aware AI.<br /><br />
                                    It detects stress, hesitation, and excitement in real-time â and negotiates accordingly.
                                </div>
                                <button onClick={() => setShowSetup(true)} style={{
                                    padding: '14px 32px', borderRadius: '14px', border: 'none',
                                    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                                    color: '#fff', fontWeight: '700', fontSize: '15px', cursor: 'pointer',
                                    boxShadow: '0 4px 24px rgba(99,102,241,0.5)',
                                }}>ðï¸ Start First Voice Negotiation</button>
                            </div>
                        </div>
                    )
                })()}
            </div>
        </div>
    )
}
