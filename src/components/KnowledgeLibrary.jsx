import { useState, useEffect } from 'react'
import { supabase } from '../api/supabaseClient'
import Linkify from '../lib/Linkify'

/**
 * Knowledge Library — Deal Table reskin.
 * Same data flow, tabs, and process pipeline as before; visual language now
 * matches the Sparring Arena (felt green, ledger ivory, brass).
 */

const T = {
    feltDeep: '#0E261D',
    felt: '#13301F',
    feltRaised: '#1A3B28',
    line: 'rgba(201,162,39,0.16)',
    ivory: '#F1EBDD',
    ivoryDim: 'rgba(241,235,221,0.62)',
    ivoryFaint: 'rgba(241,235,221,0.38)',
    brass: '#C9A227',
    brassBright: '#E3BD45',
    signal: '#C75146',
    calm: '#7FA88F',
    violet: '#A98BC9',
    steel: '#7FA3B8',
    fontDisplay: '"Fraunces", Georgia, serif',
    fontUi: '"Schibsted Grotesk", "Inter", sans-serif',
    fontMono: '"IBM Plex Mono", "JetBrains Mono", monospace',
}

const FONTS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Schibsted+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
.kl-root::-webkit-scrollbar { width: 5px; }
.kl-root::-webkit-scrollbar-thumb { background: rgba(201,162,39,0.25); border-radius: 99px; }
`

const sourceTypeColors = { historical: '#C9A227', research: '#7FA3B8', case_study: '#A98BC9' }
const sourceTypeLabels = { historical: 'Historical', research: 'Research', case_study: 'Case study' }
const patternSourceColors = { own_negotiation: '#8FBF9F', historical: '#C9A227', research: '#7FA3B8' }
const patternSourceLabels = { own_negotiation: 'Own table', historical: 'Historical', research: 'Research' }

export default function KnowledgeLibrary() {
    const [sources, setSources] = useState([])
    const [patterns, setPatterns] = useState([])
    const [form, setForm] = useState({ title: '', source_type: 'historical', domain_tags: '', content_text: '' })
    const [processing, setProcessing] = useState(null)
    const [activeTab, setActiveTab] = useState('sources')

    useEffect(() => {
        loadSources()
        loadPatterns()
    }, [])

    async function loadSources() {
        const { data } = await supabase.from('knowledge_sources').select('*').order('created_at', { ascending: false })
        setSources(data || [])
    }

    async function loadPatterns() {
        const { data } = await supabase.from('learned_patterns').select('*').order('created_at', { ascending: false }).limit(100)
        setPatterns(data || [])
    }

    async function handleAddSource(e) {
        e.preventDefault()
        const tags = form.domain_tags.split(',').map(t => t.trim()).filter(Boolean)
        const { data, error } = await supabase.from('knowledge_sources').insert({
            title: form.title,
            source_type: form.source_type,
            domain_tags: tags,
            content_text: form.content_text,
        }).select().single()
        if (error) { alert('Error: ' + error.message); return }
        setForm({ title: '', source_type: 'historical', domain_tags: '', content_text: '' })
        setSources(prev => [data, ...prev])
        handleProcess(data.id)
    }

    async function handleProcess(id) {
        setProcessing(id)
        try {
            const res = await fetch('/.netlify/functions/process-knowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ knowledge_id: id }),
            })
            const result = await res.json()
            await loadSources()
            await loadPatterns()
            alert(`Extracted ${result.patterns_extracted} patterns`)
        } catch (err) {
            alert('Processing failed: ' + err.message)
        } finally {
            setProcessing(null)
        }
    }

    // ── styles ──
    const card = { background: T.felt, border: `1px solid ${T.line}`, borderRadius: 12, padding: '14px 16px' }
    const input = {
        width: '100%', background: T.feltRaised, border: `1px solid ${T.line}`, borderRadius: 10,
        padding: '9px 13px', color: T.ivory, fontSize: 13.5, fontFamily: T.fontUi, boxSizing: 'border-box', outline: 'none',
    }
    const label = { fontSize: 11.5, color: T.ivoryDim, display: 'block', marginBottom: 6 }
    const chip = (color) => ({
        fontSize: 11, padding: '2px 9px', borderRadius: 99,
        border: `1px solid ${color}44`, color, background: `${color}14`,
    })

    return (
        <div className="kl-root" style={{
            height: '100%', overflowY: 'auto', overscrollBehavior: 'contain',
            background: `radial-gradient(120% 90% at 50% -10%, #16382A 0%, ${T.feltDeep} 55%, #0A1D15 100%)`,
            color: T.ivory, fontFamily: T.fontUi, padding: 24,
        }}>
            <style>{FONTS_CSS}</style>
            <div style={{ maxWidth: 1040, margin: '0 auto' }}>

                {/* Header */}
                <div style={{ marginBottom: 22 }}>
                    <h1 style={{ fontFamily: T.fontDisplay, fontSize: 26, fontWeight: 600, margin: 0 }}>
                        The Library<span style={{ color: T.brass }}>.</span>
                    </h1>
                    <p style={{ color: T.ivoryDim, fontSize: 13, margin: '5px 0 0', lineHeight: 1.5 }}>
                        Every negotiation worth studying — fed to the engine as live tactical experience.
                    </p>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
                    {[
                        { label: 'Sources on file', value: sources.length, color: T.steel },
                        { label: 'Patterns learned', value: patterns.length, color: T.brassBright },
                        { label: 'From our own tables', value: patterns.filter(p => p.source_type === 'own_negotiation').length, color: '#8FBF9F' },
                        { label: 'From history', value: patterns.filter(p => p.source_type === 'historical').length, color: T.violet },
                    ].map(s => (
                        <div key={s.label} style={{ flex: '1 1 140px', ...card, padding: '12px 16px' }}>
                            <div style={{ fontFamily: T.fontMono, fontSize: 22, fontWeight: 500, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 11, color: T.ivoryFaint, marginTop: 2, letterSpacing: '0.04em' }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${T.line}` }}>
                    {[['sources', 'Sources'], ['patterns', 'Patterns'], ['add', 'Add source']].map(([tab, lbl]) => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            padding: '9px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                            borderBottom: activeTab === tab ? `2px solid ${T.brass}` : '2px solid transparent',
                            background: 'transparent', fontFamily: T.fontUi,
                            color: activeTab === tab ? T.brassBright : T.ivoryFaint,
                        }}>
                            {lbl}
                        </button>
                    ))}
                </div>

                {/* Sources */}
                {activeTab === 'sources' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 40 }}>
                        {sources.length === 0 && (
                            <div style={{ color: T.ivoryFaint, textAlign: 'center', padding: 40, fontSize: 13, lineHeight: 1.6 }}>
                                Nothing on file yet. Add a case, an article, or a famous deal —<br />the engine turns it into tactics.
                            </div>
                        )}
                        {sources.map(s => (
                            <div key={s.id} style={card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 500, fontSize: 14.5, color: T.ivory }}>{s.title}</div>
                                        <div style={{ display: 'flex', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
                                            <span style={chip(sourceTypeColors[s.source_type] || T.ivoryDim)}>
                                                {sourceTypeLabels[s.source_type] || s.source_type}
                                            </span>
                                            {(s.domain_tags || []).map(tag => (
                                                <span key={tag} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 99, background: 'rgba(241,235,221,0.06)', color: T.ivoryDim }}>{tag}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                        {s.processed && (
                                            <span style={{ fontFamily: T.fontMono, fontSize: 11, color: '#8FBF9F' }}>
                                                {s.pattern_count} patterns
                                            </span>
                                        )}
                                        {!s.processed && (
                                            <button onClick={() => handleProcess(s.id)} disabled={processing === s.id} style={{
                                                fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
                                                border: `1px solid ${T.brass}`, fontFamily: T.fontUi,
                                                background: processing === s.id ? 'transparent' : T.brass,
                                                color: processing === s.id ? T.ivoryDim : '#1B1503',
                                            }}>
                                                {processing === s.id ? 'Processing…' : 'Process'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div style={{ color: T.ivoryFaint, fontSize: 11.5, marginTop: 9, lineHeight: 1.5 }}>
                                    <Linkify text={(s.content_text || '').slice(0, 140) + '…'} linkColor={T.brassBright} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Patterns */}
                {activeTab === 'patterns' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingBottom: 40 }}>
                        {patterns.length === 0 && (
                            <div style={{ color: T.ivoryFaint, textAlign: 'center', padding: 40, fontSize: 13 }}>
                                No patterns yet. Add and process a source to start learning.
                            </div>
                        )}
                        {patterns.map(p => (
                            <div key={p.id} style={{ ...card, padding: '12px 15px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, gap: 10 }}>
                                    <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: patternSourceColors[p.source_type] || T.ivoryDim }}>
                                        {patternSourceLabels[p.source_type] || p.source_type}
                                        {p.domain && <span style={{ color: T.ivoryFaint, fontWeight: 400 }}> · {p.domain}</span>}
                                    </span>
                                    <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.ivoryFaint, flexShrink: 0 }}>
                                        conf {Math.round((p.confidence_score || 0.7) * 100)}%
                                    </span>
                                </div>
                                <div style={{ fontSize: 13, color: T.ivory, fontWeight: 500, marginBottom: 4 }}>{p.situation_type}</div>
                                <div style={{ fontSize: 12.5, color: T.ivoryDim, lineHeight: 1.55 }}>
                                    <Linkify text={p.lesson} linkColor={T.brassBright} />
                                </div>
                                {p.tactic_used && (
                                    <div style={{ fontSize: 11.5, color: T.ivoryFaint, marginTop: 5 }}>
                                        Tactic: <Linkify text={p.tactic_used} linkColor={T.brassBright} />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Add */}
                {activeTab === 'add' && (
                    <form onSubmit={handleAddSource} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 680, paddingBottom: 40 }}>
                        <div>
                            <label style={label}>Title</label>
                            <input style={input} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
                                placeholder="e.g. Camp David Accords — Carter/Begin/Sadat 1978" />
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 200px' }}>
                                <label style={label}>Type</label>
                                <select style={input} value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}>
                                    <option value="historical">Historical case</option>
                                    <option value="research">Research article</option>
                                    <option value="case_study">Case study</option>
                                </select>
                            </div>
                            <div style={{ flex: '1 1 240px' }}>
                                <label style={label}>Domain tags (comma separated)</label>
                                <input style={input} value={form.domain_tags} onChange={e => setForm(f => ({ ...f, domain_tags: e.target.value }))}
                                    placeholder="e.g. Real Estate, M&A, Political" />
                            </div>
                        </div>
                        <div>
                            <label style={label}>
                                Full text <span style={{ color: T.ivoryFaint }}>— paste the article, case study, or summary</span>
                            </label>
                            <textarea style={{ ...input, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} rows={14}
                                value={form.content_text} onChange={e => setForm(f => ({ ...f, content_text: e.target.value }))} required
                                placeholder="Paste the full text here. Processing extracts the tactics, tells, and lessons automatically." />
                        </div>
                        <button type="submit" style={{
                            padding: '11px 22px', background: T.brass, color: '#1B1503', border: `1px solid ${T.brass}`,
                            borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer', alignSelf: 'flex-start', fontFamily: T.fontUi,
                        }}>
                            Add &amp; process
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}
