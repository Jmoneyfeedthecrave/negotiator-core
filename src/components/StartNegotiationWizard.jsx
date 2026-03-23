/**
 * StartNegotiationWizard
 * Multi-step modal to initiate an outbound negotiation.
 * Step 1: Counterparty details
 * Step 2: Our position brief
 * Step 3: Review AI-drafted opening email → Approve & Send
 */

import { useState } from 'react'
import { apiFetch } from '../api/apiFetch'

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
const TONE_OPTIONS = ['collaborative', 'assertive', 'exploratory', 'firm']

const GLASS_INPUT = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.65)',
    border: '1px solid rgba(0,0,0,0.12)', borderRadius: '10px',
    padding: '8px 12px', fontSize: '13px', fontFamily: FONT,
    color: 'rgba(0,0,0,0.82)', outline: 'none',
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)',
}

const LABEL = {
    display: 'block', fontSize: '10px', fontWeight: '700',
    color: 'rgba(0,0,0,0.40)', letterSpacing: '0.06em',
    textTransform: 'uppercase', marginBottom: '5px',
}

export default function StartNegotiationWizard({ onClose, onCreated, supabaseClient }) {
    const [step, setStep] = useState(1)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Step 1 state
    const [cpEmail, setCpEmail] = useState('')
    const [cpName, setCpName] = useState('')

    // Step 2 state  
    const [pos, setPos] = useState({
        subject: '', goal: '', ideal_outcome: '', walkaway: '',
        batna: '', concessions_available: '', constraints: '', tone: 'collaborative',
    })
    const setP = (k, v) => setPos(p => ({ ...p, [k]: v }))

    // Step 3 state
    const [draft, setDraft] = useState(null)     // { subject, body, opening_strategy, ... }
    const [threadId, setThreadId] = useState(null)
    const [emailId, setEmailId] = useState(null)
    const [editedBody, setEditedBody] = useState('')
    const [sending, setSending] = useState(false)
    const [sent, setSent] = useState(false)

    // ── Step 1 → 2 (validate counterparty email) ──────────────────
    const goStep2 = () => {
        if (!cpEmail.includes('@')) { setError('Enter a valid email address.'); return }
        setError(null)
        setPos(p => ({ ...p, subject: p.subject || `Negotiation with ${cpName || cpEmail}` }))
        setStep(2)
    }

    // ── Step 2 → 3 (call initiate-negotiation, get draft) ─────────
    const goStep3 = async () => {
        if (!pos.goal) { setError('Primary goal is required.'); return }
        setError(null)
        setLoading(true)
        try {
            const json = await apiFetch('/.netlify/functions/initiate-negotiation', {
                method: 'POST',
                body: JSON.stringify({
                    counterparty_email: cpEmail,
                    counterparty_name:  cpName,
                    our_position:       pos,
                }),
            })
            setDraft(json.draft)
            setThreadId(json.thread_id)
            setEmailId(json.email_id)
            setEditedBody(json.draft.body)
            setStep(3)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ── Step 3 → Send ────────────────────────────────────────────
    const sendEmail = async () => {
        setSending(true)
        try {
            await apiFetch('/.netlify/functions/email-send', {
                method: 'POST',
                body: JSON.stringify({
                    email_id: emailId,
                    thread_id: threadId,
                    to_email: cpEmail,
                    subject: draft.subject,
                    body: editedBody,
                }),
            })
            setSent(true)
            setTimeout(() => {
                onCreated(threadId)
                onClose()
            }, 1500)
        } catch (err) {
            setError(err.message)
        } finally {
            setSending(false)
        }
    }

    const overlay = {
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.28)',
        backdropFilter: 'blur(12px) saturate(140%)',
        WebkitBackdropFilter: 'blur(12px) saturate(140%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    }

    const box = {
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(48px) saturate(200%)',
        WebkitBackdropFilter: 'blur(48px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.9)',
        borderRadius: '24px',
        width: '560px', maxWidth: '94vw',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.95)',
        fontFamily: FONT,
        overflow: 'hidden',
    }

    const header = {
        padding: '16px 20px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }

    const field = { marginBottom: '12px' }

    return (
        <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={box}>
                {/* Header */}
                <div style={header}>
                    <div>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: 'rgba(0,0,0,0.82)' }}>
                            Start a Negotiation
                        </div>
                        <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.40)', marginTop: '2px' }}>
                            Step {step} of 3 — {step === 1 ? 'Counterparty' : step === 2 ? 'Your Position' : 'Review Opening Email'}
                        </div>
                    </div>
                    {/* Step dots */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {[1, 2, 3].map(s => (
                            <div key={s} style={{
                                width: s === step ? '20px' : '6px', height: '6px',
                                borderRadius: '99px',
                                background: s <= step ? '#1d6bf3' : 'rgba(0,0,0,0.12)',
                                transition: 'all 0.2s ease',
                            }} />
                        ))}
                        <button onClick={onClose} style={{
                            marginLeft: '8px', background: 'rgba(0,0,0,0.06)',
                            border: 'none', borderRadius: '50%',
                            width: '26px', height: '26px', cursor: 'pointer',
                            fontSize: '13px', color: 'rgba(0,0,0,0.4)',
                        }}>✕</button>
                    </div>
                </div>

                <div style={{ padding: '18px 20px 20px' }}>

                    {/* ── STEP 1: Counterparty ──────────────────────────── */}
                    {step === 1 && (
                        <>
                            <div style={field}>
                                <label style={LABEL}>Their Email Address *</label>
                                <input value={cpEmail} onChange={e => setCpEmail(e.target.value)}
                                    placeholder="buyer@acme.com" style={GLASS_INPUT}
                                    onKeyDown={e => e.key === 'Enter' && goStep2()} />
                            </div>
                            <div style={field}>
                                <label style={LABEL}>Their Name (optional)</label>
                                <input value={cpName} onChange={e => setCpName(e.target.value)}
                                    placeholder="e.g. Sarah Chen" style={GLASS_INPUT} />
                            </div>
                            <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.38)', lineHeight: '1.6', marginBottom: '14px' }}>
                                We'll research this person and company in the background to give your AI negotiator context before the first reply.
                            </div>
                        </>
                    )}

                    {/* ── STEP 2: Our Position ─────────────────────────── */}
                    {step === 2 && (
                        <>
                            <div style={{ ...field, gridColumn: '1 / -1' }}>
                                <label style={LABEL}>Subject / What This Is About *</label>
                                <input value={pos.subject} onChange={e => setP('subject', e.target.value)}
                                    placeholder="e.g. Software contract renewal, Real estate offer" style={GLASS_INPUT} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div style={{ gridColumn: '1 / -1', ...field }}>
                                    <label style={LABEL}>Our Primary Goal *</label>
                                    <input value={pos.goal} onChange={e => setP('goal', e.target.value)}
                                        placeholder="e.g. Renew contract at $42k/yr, 2-year term" style={GLASS_INPUT} />
                                </div>
                                <div style={field}>
                                    <label style={LABEL}>Ideal Outcome</label>
                                    <input value={pos.ideal_outcome} onChange={e => setP('ideal_outcome', e.target.value)}
                                        placeholder="Best we could realistically achieve" style={GLASS_INPUT} />
                                </div>
                                <div style={field}>
                                    <label style={LABEL}>Walk-Away / Minimum</label>
                                    <input value={pos.walkaway} onChange={e => setP('walkaway', e.target.value)}
                                        placeholder="e.g. Below $36k is a no-deal" style={GLASS_INPUT} />
                                </div>
                                <div style={field}>
                                    <label style={LABEL}>Our BATNA</label>
                                    <input value={pos.batna} onChange={e => setP('batna', e.target.value)}
                                        placeholder="Best option if this fails" style={GLASS_INPUT} />
                                </div>
                                <div style={field}>
                                    <label style={LABEL}>Concessions We Can Offer</label>
                                    <input value={pos.concessions_available} onChange={e => setP('concessions_available', e.target.value)}
                                        placeholder="e.g. Flexible start date, volume discount" style={GLASS_INPUT} />
                                </div>
                                <div style={{ gridColumn: '1 / -1', ...field }}>
                                    <label style={LABEL}>Hard Constraints</label>
                                    <input value={pos.constraints} onChange={e => setP('constraints', e.target.value)}
                                        placeholder="e.g. Must close before June 1st, budget cap $50k" style={GLASS_INPUT} />
                                </div>
                            </div>
                            <div style={field}>
                                <label style={LABEL}>Opening Tone</label>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    {TONE_OPTIONS.map(t => (
                                        <button key={t} onClick={() => setP('tone', t)} style={{
                                            padding: '6px 14px', borderRadius: '99px', border: '1px solid',
                                            borderColor: pos.tone === t ? 'rgba(29,107,243,0.4)' : 'rgba(0,0,0,0.12)',
                                            background: pos.tone === t ? 'rgba(29,107,243,0.10)' : 'rgba(255,255,255,0.5)',
                                            color: pos.tone === t ? '#1a5cd8' : 'rgba(0,0,0,0.5)',
                                            fontSize: '11px', fontWeight: pos.tone === t ? '600' : '400',
                                            fontFamily: FONT, cursor: 'pointer',
                                        }}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── STEP 3: Review Opening Email ─────────────────── */}
                    {step === 3 && draft && (
                        <>
                            {draft.opening_strategy && (
                                <div style={{
                                    padding: '8px 12px', borderRadius: '10px', marginBottom: '12px',
                                    background: 'rgba(29,107,243,0.07)',
                                    border: '1px solid rgba(29,107,243,0.15)',
                                    fontSize: '11px', color: '#1a5cd8',
                                }}>
                                    <strong>Strategy:</strong> {draft.opening_strategy}
                                </div>
                            )}
                            <div style={field}>
                                <label style={LABEL}>Subject</label>
                                <div style={{
                                    ...GLASS_INPUT, padding: '8px 12px',
                                    fontSize: '13px', fontWeight: '600', color: 'rgba(0,0,0,0.72)',
                                }}>
                                    {draft.subject}
                                </div>
                            </div>
                            <div style={field}>
                                <label style={LABEL}>Opening Email — Edit if needed</label>
                                <textarea
                                    value={editedBody}
                                    onChange={e => setEditedBody(e.target.value)}
                                    rows={10}
                                    style={{
                                        ...GLASS_INPUT,
                                        resize: 'vertical', minHeight: '200px',
                                        lineHeight: '1.6', fontFamily: FONT,
                                    }}
                                />
                            </div>
                            {draft.predicted_response_type && (
                                <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.40)', marginTop: '-4px', marginBottom: '8px' }}>
                                    Predicted reply: {draft.predicted_response_type}
                                </div>
                            )}
                            {sent && (
                                <div style={{
                                    textAlign: 'center', padding: '12px',
                                    color: '#0e8a58', fontSize: '14px', fontWeight: '600',
                                }}>
                                    Email sent! Opening your thread…
                                </div>
                            )}
                        </>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '8px 12px', borderRadius: '10px', marginBottom: '10px',
                            background: 'rgba(224,52,74,0.08)', border: '1px solid rgba(224,52,74,0.2)',
                            fontSize: '12px', color: '#c0203a',
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                        {step > 1 && !sent && (
                            <button onClick={() => { setStep(s => s - 1); setError(null) }} style={{
                                padding: '8px 16px', borderRadius: '12px',
                                border: '1px solid rgba(0,0,0,0.10)',
                                background: 'rgba(0,0,0,0.04)',
                                color: 'rgba(0,0,0,0.45)', fontSize: '12px', fontFamily: FONT, cursor: 'pointer',
                            }}>← Back</button>
                        )}

                        {step === 1 && (
                            <button onClick={goStep2} style={{
                                padding: '8px 20px', borderRadius: '12px', border: 'none',
                                background: 'linear-gradient(180deg, #4a90f5 0%, #1d6bf3 100%)',
                                color: '#fff', fontSize: '13px', fontWeight: '600', fontFamily: FONT,
                                cursor: 'pointer', boxShadow: '0 2px 12px rgba(29,107,243,0.35)',
                            }}>Next →</button>
                        )}

                        {step === 2 && (
                            <button onClick={goStep3} disabled={loading} style={{
                                padding: '8px 20px', borderRadius: '12px', border: 'none',
                                background: loading ? 'rgba(0,0,0,0.15)' : 'linear-gradient(180deg, #4a90f5 0%, #1d6bf3 100%)',
                                color: loading ? 'rgba(0,0,0,0.4)' : '#fff',
                                fontSize: '13px', fontWeight: '600', fontFamily: FONT,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                boxShadow: loading ? 'none' : '0 2px 12px rgba(29,107,243,0.35)',
                            }}>
                                {loading ? 'Drafting…' : 'Draft Opening Email →'}
                            </button>
                        )}

                        {step === 3 && !sent && (
                            <button onClick={sendEmail} disabled={sending} style={{
                                padding: '8px 24px', borderRadius: '12px', border: 'none',
                                background: sending ? 'rgba(0,0,0,0.15)' : 'linear-gradient(180deg, #4a90f5 0%, #1d6bf3 100%)',
                                color: sending ? 'rgba(0,0,0,0.4)' : '#fff',
                                fontSize: '13px', fontWeight: '600', fontFamily: FONT,
                                cursor: sending ? 'not-allowed' : 'pointer',
                                boxShadow: sending ? 'none' : '0 2px 12px rgba(29,107,243,0.35)',
                            }}>
                                {sending ? 'Sending…' : 'Send Opening Email'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
