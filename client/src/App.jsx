import { useState } from 'react'
import Scanner from './components/Scanner.jsx'
import LiveMap from './components/LiveMap.jsx'

const tabs = [
  { id: 'scan', label: 'Scan Medicine' },
  { id: 'map', label: 'Live Threat Map' },
]

function App() {
  const [activeTab, setActiveTab] = useState('scan')

  return (
    <div className="min-h-screen px-4 py-6 md:px-10">
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-5 rounded-3xl border border-cyan-500/20 bg-slate-950/60 p-6 shadow-[0_20px_50px_rgba(6,182,212,0.1)] backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-300/70">
              Counterfeit Detection Network
            </p>
            <h1 className="text-3xl font-semibold text-slate-100 md:text-4xl">
              MedVerify
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Rapid image fingerprinting, real-time counterfeit intel, and a trusted
              supply chain trail for frontline pharmacists.
            </p>
          </div>
          <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-cyan-400/30 bg-slate-900/80 p-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? 'bg-cyan-400/20 text-cyan-200 shadow-inner'
                    : 'text-slate-300 hover:text-cyan-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto mt-8 w-full max-w-6xl">
        {activeTab === 'scan' ? <Scanner /> : <LiveMap />}
      </main>
    </div>
  )
}

export default App
