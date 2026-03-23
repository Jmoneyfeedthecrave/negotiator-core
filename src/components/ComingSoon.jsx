export default function ComingSoon() {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', background: 'var(--bg-app)',
            fontFamily: 'var(--font-ui)',
        }}>
            <div style={{ textAlign: 'center', maxWidth: '520px', padding: '40px 24px' }}>

                {/* Title */}
                <h2 style={{
                    fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)',
                    letterSpacing: '-0.03em', marginBottom: '10px',
                }}>
                    Multi-Platform Negotiation
                </h2>

                {/* Coming Soon pill */}
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    background: 'rgba(99,102,241,0.12)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    borderRadius: '99px', padding: '5px 16px',
                    marginBottom: '24px',
                    boxShadow: '0 0 16px rgba(99,102,241,0.15)',
                }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px #6366f1' }} />
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#a5b4fc', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Coming Soon</span>
                </div>

                {/* Description */}
                <p style={{
                    fontSize: '14px', color: 'var(--text-secondary)',
                    lineHeight: 1.8, marginBottom: '32px',
                }}>
                    Our Autonomous AI Negotiator will negotiate on your behalf across
                    multiple platforms — not just email. Seamlessly handle negotiations
                    via <strong style={{ color: 'var(--text-primary)' }}>Text</strong>,{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>Voice</strong>, and{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>Video</strong> — all
                    powered by the same strategic intelligence engine.
                </p>

                {/* Platform cards */}
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    {[
                        { label: 'Text / SMS', color: '#22d3ee', desc: 'Real-time text negotiation' },
                        { label: 'Voice Call', color: '#34d399', desc: 'AI-powered voice agent' },
                        { label: 'Video',      color: '#a78bfa', desc: 'Face-to-face AI avatar' },
                    ].map(p => (
                        <div key={p.label} style={{
                            flex: 1, padding: '18px 12px',
                            background: `${p.color}08`,
                            border: `1px solid ${p.color}25`,
                            borderRadius: '14px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: p.color, marginBottom: '6px' }}>{p.label}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.desc}</div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    )
}
