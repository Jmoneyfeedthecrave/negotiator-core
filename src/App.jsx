import { useState } from 'react'
import './index.css'
import TestHarness from './components/TestHarness.jsx'
import SimRunner from './components/SimRunner.jsx'

const TABS = [
  { id: 'harness', label: '⚡ Test Harness' },
  { id: 'sim', label: '🎯 Simulation Runner' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('harness')

  const s = {
    nav: { display: 'flex', gap: '0', borderBottom: '1px solid #1e293b', marginBottom: '0', background: '#0a0a0f' },
    tab: (active) => ({
      padding: '10px 20px',
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontSize: '13px',
      background: 'none',
      border: 'none',
      color: active ? '#e2e8f0' : '#475569',
      borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
      transition: 'color 0.15s',
    }),
  }

  return (
    <div>
      <nav style={s.nav}>
        {TABS.map(t => (
          <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {activeTab === 'harness' && <TestHarness />}
      {activeTab === 'sim' && <SimRunner />}
    </div>
  )
}
