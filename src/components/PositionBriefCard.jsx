/**
 * PositionBriefCard
 * Shows the AI-drafted (inbound) or user-confirmed (outbound) negotiation brief.
 * Appears when position_confirmed === false after a thread is selected.
 * User can edit any field then click "Lock It In" to confirm.
 */

import { useState } from 'react'

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"

const TONE_OPTIONS = ['collaborative', 'assertive', 'exploratory', 'firm']

const FIELD_CONFIG = [
    { key: 'negotiation_type', label: 'Negotiation Type',      placeholder: 'e.g. Real estate purchase, Software contract renewal' },
    { key: 'goal',             label: 'Our Primary Goal',      placeholder: 'e.g. Sell for ≥ $480k, Renew at $42k/yr' },
    { key: 'ideal_outcome',    label: 'Ideal Outcome',         placeholder: 'Best realistic outcome we could achieve' },
    { key: 'walkaway',         label: 'Walk-Away / Minimum',   placeholder: 'e.g. Below $440k is a no-deal' },
    { key: 'batna',            label: 'Our BATNA',             placeholder: 'Best alternative if this deal falls through' },
    { key: 'concessions_available', label: 'Concessions We Can Offer', placeholder: 'e.g. Cover closing costs, extend deadline' },
    { key: 'constraints',      label: 'Hard Constraints',      placeholder: 'e.g. Must close before June 1st' },
]

export default function PositionBriefCard({ thread, onConfirm, onDismiss }) {
    const pos = thread?.our_position || {}
    const isAiDrafted = !thread?.position_confirmed && thread?.thread_type === 'inbound'

    const [fields, setFields] = useState({
        negotiation_type:       pos.negotiation_type       || '',
        goal:                   pos.goal                   || '',
        ideal_outcome:          pos.ideal_outcome          || '',
        walkaway:               pos.walkaway               || '',
        batna:                  pos.batna                  || '',
        concessions_available:  pos.concessions_available  || '',
        constraints:            pos.constraints            || '',
        tone:                   pos.tone                   || 'collaborative',
    })
    const [saving, setSaving] = useState(false)

    const set = (key, val) => setFields(f => ({ ...f, [key]: val }))

    const handleConfirm = async () => {
        setSaving(true)
        try {
            await onConfirm(fields)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div style={{
            margin: '16px 18px',
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(32px) saturate(180%)',
            WebkitBackdropFilter: 'blur(32px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: '18px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.9)',
            fontFamily: FONT,
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '12px 16px',
                background: 'rgba(29,107,243,0.08)',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
                display: 'flex', alignItems: 'center', gap: '10px',
            }}>
                <span style={{ fontSize: '20px' }}>📋</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'rgba(0,0,0,0.82)' }}>
                        {isAiDrafted ? 'AI-Drafted Position Brief' : 'Negotiation Brief'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'rgba(0,0,0,0.42)', marginTop: '1px' }}>
                        {isAiDrafted
                            ? 'I read the email and drafted your position. Review and confirm — takes 10 seconds.'
                            : 'Your negotiation brief. Edit anything, then lock it in.'}
                    </div>
                </div>
                {pos.counterparty_wants && (
                    <div style={{
                        fontSize: '10px', padding: '4px 10px',
                        background: 'rgba(224,52,74,0.08)',
                        border: '1px solid rgba(224,52,74,0.18)',
                        borderRadius: '99px',
                        color: '#c0203a', fontWeight: '600',
                        maxWidth: '180px', textAlign: 'right',
                    }}>
                        They want: {pos.counterparty_wants?.slice(0, 60)}{pos.counterparty_wants?.length > 60 ? '…' : ''}
                    </div>
                )}
            </div>

            {/* Fields */}
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {FIELD_CONFIG.map(({ key, label, placeholder }) => (
                    <div key={key} style={{ gridColumn: ['goal', 'ideal_outcome', 'concessions_available', 'constraints'].includes(key) ? '1 / -1' : 'auto' }}>
                        <label style={{ display: 'block', fontSize: '10px', fontWeight: '700', color: 'rgba(0,0,0,0.40)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' }}>
                            {label}
                        </label>
                        <input
                            value={fields[key]}
                            onChange={e => set(key, e.target.value)}
                            placeholder={placeholder}
                            style={{
                                width: '100%', boxSizing: 'border-box',
                                background: 'rgba(255,255,255,0.65)',
                                border: '1px solid rgba(0,0,0,0.12)',
                                borderRadius: '10px',
                                padding: '7px 11px',
                                fontSize: '12px', fontFamily: FONT,
                                color: 'rgba(0,0,0,0.82)', outline: 'none',
                                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)',
                            }}
                        />
                    </div>
                ))}

                {/* Tone selector */}
                <div style={{ gridColumn: 'auto' }}>
                    <label style={{ display: 'block', fontSize: '10px', fontWeight: '700', color: 'rgba(0,0,0,0.40)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' }}>
                        Tone
                    </label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {TONE_OPTIONS.map(t => (
                            <button
                                key={t}
                                onClick={() => set('tone', t)}
                                style={{
                                    padding: '5px 12px', borderRadius: '99px',
                                    border: '1px solid',
                                    borderColor: fields.tone === t ? 'rgba(29,107,243,0.4)' : 'rgba(0,0,0,0.12)',
                                    background: fields.tone === t ? 'rgba(29,107,243,0.10)' : 'rgba(255,255,255,0.5)',
                                    color: fields.tone === t ? '#1a5cd8' : 'rgba(0,0,0,0.5)',
                                    fontSize: '11px', fontWeight: fields.tone === t ? '600' : '400',
                                    fontFamily: FONT, cursor: 'pointer',
                                    boxShadow: fields.tone === t ? '0 1px 4px rgba(29,107,243,0.12)' : 'none',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div style={{
                padding: '10px 16px 14px',
                display: 'flex', gap: '8px', alignItems: 'center',
                borderTop: '1px solid rgba(0,0,0,0.05)',
            }}>
                <button
                    onClick={handleConfirm}
                    disabled={saving || !fields.goal}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '8px 18px', borderRadius: '12px', border: 'none',
                        background: 'linear-gradient(180deg, #4a90f5 0%, #1d6bf3 100%)',
                        color: '#fff', fontSize: '13px', fontWeight: '600', fontFamily: FONT,
                        cursor: saving || !fields.goal ? 'not-allowed' : 'pointer',
                        opacity: saving || !fields.goal ? 0.5 : 1,
                        boxShadow: '0 2px 12px rgba(29,107,243,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                        transition: 'all 0.18s ease',
                    }}
                >
                    {saving ? '⏳ Saving…' : '✓ Lock It In'}
                </button>
                <button
                    onClick={onDismiss}
                    style={{
                        padding: '8px 15px', borderRadius: '12px',
                        border: '1px solid rgba(0,0,0,0.10)',
                        background: 'rgba(0,0,0,0.04)',
                        color: 'rgba(0,0,0,0.45)', fontSize: '12px', fontFamily: FONT,
                        cursor: 'pointer',
                    }}
                >
                    Later
                </button>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'rgba(0,0,0,0.28)' }}>
                    {isAiDrafted ? '🤖 AI-suggested · edit anything' : 'Your brief · edit anytime'}
                </span>
            </div>
        </div>
    )
}
