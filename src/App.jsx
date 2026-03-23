import { useState } from 'react'
import './index.css'
import EmailNegotiator from './components/EmailNegotiator.jsx'
import KnowledgeLibrary from './components/KnowledgeLibrary.jsx'
import VoiceNegotiator from './components/VoiceNegotiator.jsx'

const TABS = [
    { id: 'email',   label: '✉️ Email' },
    { id: 'voice',   label: '🎙️ Voice' },
    { id: 'knowledge', label: '📚 Knowledge' },
]

export default function App() {
    const [activeTab, setActiveTab] = useState('email')
    const [hovered, setHovered] = useState(null)

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-app)' }}>

            {/* ── Dark Command Bar ──────────────────────────────────── */}
            <header style={{
                display: 'flex', alignItems: 'center',
                padding: '0 18px', height: '48px',
                background: 'rgba(10,13,20,0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderBottom: '1px solid var(--border-mid)',
                boxShadow: '0 1px 0 rgba(255,255,255,0.04)',
                flexShrink: 0, zIndex: 100, gap: '4px',
            }}>
                {/* Logo */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '24px', flexShrink: 0 }}>
                    <div style={{
                        width: '30px', height: '30px', borderRadius: '9px',
                        background: 'linear-gradient(145deg, #4a90f5 0%, #1d6bf3 50%, #1250d4 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '15px',
                        boxShadow: '0 2px 12px rgba(29,107,243,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
                    }}/>
                    <div>
                        <div style={{ fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '0.04em', lineHeight: 1 }}>ARCHI</div>
                    </div>
                </div>

                {/* Tabs */}
                <nav style={{ display: 'flex', gap: '2px', flex: 1 }}>
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
                                    padding: '5px 13px', borderRadius: '9px',
                                    background: active
                                        ? 'rgba(59,130,246,0.15)'
                                        : isHov ? 'rgba(255,255,255,0.05)' : 'transparent',
                                    border: '1px solid',
                                    borderColor: active ? 'rgba(59,130,246,0.3)' : 'transparent',
                                    color: active ? '#60a5fa' : 'var(--text-muted)',
                                    fontSize: '12px', fontWeight: active ? '600' : '400',
                                    fontFamily: 'var(--font-ui)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    boxShadow: active ? '0 0 12px rgba(59,130,246,0.15)' : 'none',
                                }}
                            >
                                {t.label}
                            </button>
                        )
                    })}
                </nav>

                {/* Live pill */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: 'rgba(52,211,153,0.08)',
                    border: '1px solid rgba(52,211,153,0.2)',
                    borderRadius: '99px', padding: '4px 12px',
                    boxShadow: '0 0 12px rgba(52,211,153,0.1)',
                    flexShrink: 0,
                }}>
                    <span className="dot dot-green" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }} />
                    <span style={{ fontSize: '11px', color: '#34d399', fontWeight: '600' }}>Live</span>
                </div>
            </header>

            <main style={{ flex: 1, overflow: 'hidden' }}>
                {activeTab === 'email'     && <EmailNegotiator />}
                {activeTab === 'voice'     && <VoiceNegotiator />}
                {activeTab === 'knowledge' && <KnowledgeLibrary />}
            </main>
        </div>
    )
}
