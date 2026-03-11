import { useState } from 'react'
import './index.css'
import TestHarness from './components/TestHarness.jsx'
import EmailNegotiator from './components/EmailNegotiator.jsx'
import KnowledgeLibrary from './components/KnowledgeLibrary.jsx'

const TABS = [
    { id: 'email',     label: 'Email Negotiator', icon: '✉️' },
    { id: 'knowledge', label: 'Knowledge Library', icon: '🧠' },
    { id: 'harness',   label: 'Test Harness',      icon: '⚡' },
]

export default function App() {
    const [activeTab, setActiveTab] = useState('email')
    const [hovered, setHovered] = useState(null)

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {/* ── macOS-style glass menu bar ──────────────────────── */}
            <header style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 18px',
                height: '50px',
                background: 'rgba(255,255,255,0.60)',
                backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                borderBottom: '1px solid rgba(255,255,255,0.85)',
                boxShadow: '0 1px 0 rgba(0,0,0,0.06), 0 2px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
                flexShrink: 0,
                zIndex: 100,
                gap: '4px',
            }}>
                {/* Logo mark */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginRight: '22px', flexShrink: 0 }}>
                    <div style={{
                        width: '28px', height: '28px', borderRadius: '8px',
                        background: 'linear-gradient(145deg, #4a90f5 0%, #1d6bf3 50%, #1250d4 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '15px',
                        boxShadow: '0 2px 8px rgba(29,107,243,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
                    }}>⚖️</div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'rgba(0,0,0,0.82)', letterSpacing: '-0.02em', lineHeight: 1 }}>Negotiator</div>
                        <div style={{ fontSize: '9px', color: 'rgba(0,0,0,0.35)', letterSpacing: '0.14em', fontWeight: '600', marginTop: '1px' }}>CORE</div>
                    </div>
                </div>

                {/* Tab pills */}
                <nav style={{ display: 'flex', gap: '3px', flex: 1 }}>
                    {TABS.map(t => {
                        const active = activeTab === t.id
                        const isHov  = hovered === t.id && !active
                        return (
                            <button
                                key={t.id}
                                onClick={() => setActiveTab(t.id)}
                                onMouseEnter={() => setHovered(t.id)}
                                onMouseLeave={() => setHovered(null)}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                                    padding: '5px 13px',
                                    background: active
                                        ? 'rgba(29,107,243,0.12)'
                                        : isHov ? 'rgba(0,0,0,0.05)' : 'transparent',
                                    backdropFilter: active ? 'blur(8px)' : 'none',
                                    WebkitBackdropFilter: active ? 'blur(8px)' : 'none',
                                    border: '1px solid',
                                    borderColor: active ? 'rgba(29,107,243,0.28)' : 'transparent',
                                    borderRadius: '10px',
                                    color: active ? '#1a5cd8' : 'rgba(0,0,0,0.48)',
                                    fontSize: '12px', fontWeight: active ? '600' : '400',
                                    fontFamily: 'Inter, sans-serif',
                                    cursor: 'pointer',
                                    transition: 'all 0.16s cubic-bezier(0.25,0.46,0.45,0.94)',
                                    boxShadow: active
                                        ? '0 1px 4px rgba(29,107,243,0.12), inset 0 1px 0 rgba(255,255,255,0.8)'
                                        : 'none',
                                }}
                            >
                                <span style={{ fontSize: '12px' }}>{t.icon}</span>
                                {t.label}
                            </button>
                        )
                    })}
                </nav>

                {/* Live indicator pill */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: 'rgba(26,184,122,0.12)',
                    border: '1px solid rgba(26,184,122,0.28)',
                    borderRadius: '99px', padding: '4px 11px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
                    flexShrink: 0,
                }}>
                    <span className="dot dot-green anim-blink" />
                    <span style={{ fontSize: '11px', color: '#0e8a58', fontWeight: '600' }}>Live</span>
                </div>
            </header>

            <main style={{ flex: 1, overflow: 'hidden' }}>
                {activeTab === 'email'     && <EmailNegotiator />}
                {activeTab === 'knowledge' && <KnowledgeLibrary />}
                {activeTab === 'harness'   && <TestHarness />}
            </main>
        </div>
    )
}
