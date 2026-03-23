import { useState, useEffect } from 'react'
import { supabase } from '../api/supabaseClient'
import { apiFetch } from '../api/apiFetch'

export default function KnowledgeLibrary() {
    const [sources, setSources] = useState([])
    const [patterns, setPatterns] = useState([])
    const [form, setForm] = useState({ title: '', source_type: 'historical', domain_tags: '', content_text: '' })
    const [processing, setProcessing] = useState(null)
    const [activeTab, setActiveTab] = useState('sources')
    const [addMode, setAddMode] = useState('text') // 'url' | 'pdf' | 'text'
    const [urlInput, setUrlInput] = useState('')
    const [urlLoading, setUrlLoading] = useState(false)
    const [pdfLoading, setPdfLoading] = useState(false)

    useEffect(() => {
        loadSources()
        loadPatterns()
    }, [])

    async function loadSources() {
        const { data } = await supabase.from('knowledge_sources').select('*').order('created_at', { ascending: false })
        setSources(data || [])
    }

    async function loadPatterns() {
        const { data } = await supabase.from('learned_patterns').select('*').order('confidence_score', { ascending: false }).limit(500)
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
            const result = await apiFetch('/.netlify/functions/process-knowledge', {
                method: 'POST',
                body: JSON.stringify({ knowledge_id: id }),
            })
            await loadSources()
            await loadPatterns()
            alert(`Extracted ${result.patterns_extracted} patterns`)
        } catch (err) {
            alert('Processing failed: ' + err.message)
        } finally {
            setProcessing(null)
        }
    }

    async function handleUrlIngest(e) {
        e.preventDefault()
        if (!urlInput) return
        setUrlLoading(true)
        try {
            const result = await apiFetch('/.netlify/functions/ingest-url', {
                method: 'POST',
                body: JSON.stringify({
                    url: urlInput,
                    title: form.title || undefined,
                    source_type: form.source_type,
                    domain_tags: form.domain_tags,
                }),
            })
            setUrlInput('')
            setForm(f => ({ ...f, title: '' }))
            alert(`Ingested ${result.chars_extracted} chars — processing patterns...`)
            setTimeout(() => { loadSources(); loadPatterns() }, 8000)
        } catch (err) {
            alert('URL ingestion failed: ' + err.message)
        } finally {
            setUrlLoading(false)
        }
    }

    async function handlePdfUpload(e) {
        const file = e.target.files?.[0]
        if (!file) return
        setPdfLoading(true)
        try {
            const reader = new FileReader()
            const base64 = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result.split(',')[1])
                reader.onerror = reject
                reader.readAsDataURL(file)
            })
            const result = await apiFetch('/.netlify/functions/ingest-pdf', {
                method: 'POST',
                body: JSON.stringify({
                    pdf_base64: base64,
                    title: form.title || file.name.replace('.pdf', ''),
                    source_type: form.source_type,
                    domain_tags: form.domain_tags,
                }),
            })
            setForm(f => ({ ...f, title: '' }))
            alert(`Extracted ${result.chars_extracted} chars from PDF — processing patterns...`)
            setTimeout(() => { loadSources(); loadPatterns() }, 8000)
        } catch (err) {
            alert('PDF upload failed: ' + err.message)
        } finally {
            setPdfLoading(false)
        }
    }

    const sourceTypeColors = { historical: '#f59e0b', research: '#3b82f6', case_study: '#8b5cf6', simulation: '#ec4899', self_discovered: '#06b6d4' }
    const sourceTypeLabels = { historical: 'Historical', research: 'Research', case_study: 'Case Study', simulation: 'Simulation', self_discovered: 'Self-Discovered' }
    const patternSourceColors = { own_negotiation: '#10b981', historical: '#f59e0b', research: '#3b82f6', simulation: '#ec4899', self_discovered: '#06b6d4' }

    return (
        <div style={{ height: '100%', overflowY: 'auto', background: '#0a0f1e', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '24px', boxSizing: 'border-box' }}>
            <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

                {/* Header */}
                <div style={{ marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Knowledge Library</h1>
                    <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>
                        Train the AI on historical negotiations and research. Every article becomes live tactical experience.
                    </p>
                </div>

                {/* Stats bar */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                    {[
                        { label: 'Knowledge Sources', value: sources.length, color: '#3b82f6' },
                        { label: 'Patterns Learned', value: patterns.length, color: '#10b981' },
                        { label: 'Simulation', value: patterns.filter(p => p.source_type === 'simulation').length, color: '#ec4899' },
                        { label: 'Self-Discovered', value: patterns.filter(p => p.source_type === 'self_discovered').length, color: '#06b6d4' },
                    ].map(s => (
                        <div key={s.label} style={{ flex: 1, background: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px 16px' }}>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid #1e293b' }}>
                    {['sources', 'patterns', 'add'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: 'none',
                            borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
                            background: 'transparent', color: activeTab === tab ? '#3b82f6' : '#64748b',
                        }}>
                            {tab === 'sources' ? 'Sources' : tab === 'patterns' ? 'Patterns' : 'Add Source'}
                        </button>
                    ))}
                </div>

                {/* Sources tab */}
                {activeTab === 'sources' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {sources.length === 0 && <div style={{ color: '#475569', textAlign: 'center', padding: '40px' }}>No knowledge sources yet. Add one to start training.</div>}
                        {sources.map(s => (
                            <div key={s.id} style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '14px 16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: '#f1f5f9' }}>{s.title}</div>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#1e293b', color: sourceTypeColors[s.source_type] }}>
                                                {sourceTypeLabels[s.source_type]}
                                            </span>
                                            {(s.domain_tags || []).map(tag => (
                                                <span key={tag} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#0f172a', color: '#94a3b8' }}>{tag}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                                        {s.processed && <span style={{ fontSize: '11px', color: '#10b981' }}>{s.pattern_count} patterns</span>}
                                        {!s.processed && (
                                            <button onClick={() => handleProcess(s.id)} disabled={processing === s.id} style={{
                                                fontSize: '12px', padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                                background: processing === s.id ? '#1e293b' : '#1d4ed8', color: '#fff',
                                            }}>
                                                {processing === s.id ? 'Processing…' : 'Process'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div style={{ color: '#475569', fontSize: '11px', marginTop: '8px' }}>{s.content_text.slice(0, 120)}…</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Patterns tab */}
                {activeTab === 'patterns' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {patterns.length === 0 && <div style={{ color: '#475569', textAlign: 'center', padding: '40px' }}>No patterns yet. Add and process a knowledge source.</div>}
                        {patterns.map(p => (
                            <div key={p.id} style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px 14px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: patternSourceColors[p.source_type], textTransform: 'uppercase' }}>
                                        {p.source_type === 'own_negotiation' ? 'Own' : p.source_type === 'historical' ? 'Historical' : 'Research'}
                                        {p.domain && ` · ${p.domain}`}
                                    </span>
                                    <span style={{ fontSize: '10px', color: '#475569' }}>confidence: {Math.round((p.confidence_score || 0.7) * 100)}%</span>
                                </div>
                                <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>{p.situation_type}</div>
                                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{p.lesson}</div>
                                {p.tactic_used && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Tactic: {p.tactic_used}</div>}
                            </div>
                        ))}
                    </div>
                )}

                {/* Add Source tab */}
                {activeTab === 'add' && (
                    <div style={{ maxWidth: '700px' }}>
                        {/* Mode selector */}
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
                            {[
                                { id: 'url', label: 'Paste URL' },
                                { id: 'pdf', label: 'Upload PDF' },
                                { id: 'text', label: 'Paste Text' },
                            ].map(m => (
                                <button key={m.id} onClick={() => setAddMode(m.id)} style={{
                                    padding: '6px 14px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                                    borderRadius: '6px',
                                    background: addMode === m.id ? '#1d4ed8' : '#1e293b',
                                    color: addMode === m.id ? '#fff' : '#94a3b8',
                                }}>
                                    {m.label}
                                </button>
                            ))}
                        </div>

                        {/* Shared fields: title, type, tags */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
                            <div>
                                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Title (optional for URL/PDF)</label>
                                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                    placeholder="e.g. Never Split the Difference — Chapter 3"
                                    style={{ width: '100%', background: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px 12px', color: '#f1f5f9', fontSize: '13px', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Type</label>
                                    <select value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}
                                        style={{ width: '100%', background: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px 12px', color: '#f1f5f9', fontSize: '13px' }}>
                                        <option value="historical">Historical Case</option>
                                        <option value="research">Research Article</option>
                                        <option value="case_study">Case Study</option>
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Domain Tags (comma separated)</label>
                                    <input value={form.domain_tags} onChange={e => setForm(f => ({ ...f, domain_tags: e.target.value }))}
                                        placeholder="e.g. Real Estate, M&A, Political"
                                        style={{ width: '100%', background: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px 12px', color: '#f1f5f9', fontSize: '13px', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                        </div>

                        {/* URL Mode */}
                        {addMode === 'url' && (
                            <form onSubmit={handleUrlIngest} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Article URL</label>
                                    <input value={urlInput} onChange={e => setUrlInput(e.target.value)} required type="url"
                                        placeholder="https://en.wikipedia.org/wiki/Camp_David_Accords"
                                        style={{ width: '100%', background: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px 12px', color: '#f1f5f9', fontSize: '13px', boxSizing: 'border-box' }} />
                                </div>
                                <button type="submit" disabled={urlLoading} style={{
                                    padding: '10px 24px', background: urlLoading ? '#1e293b' : 'linear-gradient(135deg, #1d4ed8, #7c3aed)', color: '#fff',
                                    border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', alignSelf: 'flex-start',
                                }}>
                                    {urlLoading ? 'Fetching & processing...' : 'Ingest URL'}
                                </button>
                            </form>
                        )}

                        {/* PDF Mode */}
                        {addMode === 'pdf' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Upload PDF</label>
                                    <input type="file" accept=".pdf" onChange={handlePdfUpload} disabled={pdfLoading}
                                        style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '8px 12px', color: '#f1f5f9', fontSize: '13px' }} />
                                </div>
                                {pdfLoading && <div style={{ color: '#a5b4fc', fontSize: '13px' }}>Extracting text from PDF and processing patterns...</div>}
                            </div>
                        )}

                        {/* Text Mode (original) */}
                        {addMode === 'text' && (
                            <form onSubmit={handleAddSource} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                                        Article / Case Study Text <span style={{ color: '#475569' }}>(paste full text)</span>
                                    </label>
                                    <textarea value={form.content_text} onChange={e => setForm(f => ({ ...f, content_text: e.target.value }))} required
                                        rows={16} placeholder="Paste the full text of the article, Wikipedia summary, research paper, or case study here..."
                                        style={{ width: '100%', background: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '10px 12px', color: '#f1f5f9', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                                </div>
                                <button type="submit" style={{
                                    padding: '10px 24px', background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)', color: '#fff',
                                    border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', alignSelf: 'flex-start',
                                }}>
                                    Add &amp; Process
                                </button>
                            </form>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
