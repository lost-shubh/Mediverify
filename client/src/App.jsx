import { useEffect, useMemo, useState } from 'react'
import Scanner from './components/Scanner.jsx'
import LiveMap from './components/LiveMap.jsx'
import api, { getApiErrorMessage } from './lib/api.js'

const tabs = [
  { id: 'scan', label: 'Scan Medicine' },
  { id: 'map', label: 'Live Threat Map' },
]

function App() {
  const [activeTab, setActiveTab] = useState('scan')
  const [system, setSystem] = useState({
    loading: true,
    error: '',
    health: null,
    model: null,
  })

  useEffect(() => {
    let active = true

    const loadSystem = async () => {
      try {
        const [healthResponse, modelResponse] = await Promise.all([
          api.get('/api/health'),
          api.get('/api/model-info'),
        ])

        if (!active) return

        setSystem({
          loading: false,
          error: '',
          health: healthResponse.data,
          model: modelResponse.data,
        })
      } catch (requestError) {
        if (!active) return

        setSystem((current) => ({
          loading: false,
          error: getApiErrorMessage(
            requestError,
            'Unable to load system status.'
          ),
          health: current.health,
          model: current.model,
        }))
      }
    }

    void loadSystem()

    return () => {
      active = false
    }
  }, [])

  const trainingSummary = useMemo(() => {
    if (!system.model) {
      return system.loading ? 'Checking...' : 'Unavailable'
    }

    const authenticSamples = Number(system.model.dataset?.authenticSamples || 0)
    const counterfeitSamples = Number(system.model.dataset?.counterfeitSamples || 0)
    const totalSamples = authenticSamples + counterfeitSamples

    return system.model.trained ? `${totalSamples} labeled images` : 'Baseline profile only'
  }, [system.loading, system.model])

  const storageSummary = useMemo(() => {
    const persistence = system.health?.reports?.store?.persistence

    if (!persistence) {
      return system.loading ? 'Checking...' : 'Unavailable'
    }

    return persistence === 'ephemeral' ? 'Session memory' : 'Process memory'
  }, [system.health, system.loading])

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
              Feature-based counterfeit screening, FDA medicine lookup, and a live
              crowdsourced threat map for hackathon demos.
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

      {system.error && (
        <p className="mx-auto mt-4 w-full max-w-6xl rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {system.error}
        </p>
      )}

      <section className="mx-auto mt-6 grid w-full max-w-6xl gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-cyan-500/20 bg-slate-950/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">API Status</p>
          <p className="mt-2 text-xl font-semibold text-slate-100">
            {system.health?.status === 'ok' ? 'Online' : system.loading ? 'Checking...' : 'Offline'}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {typeof system.health?.uptimeSeconds === 'number'
              ? `Uptime ${system.health.uptimeSeconds}s`
              : 'Health metadata pending'}
          </p>
        </div>
        <div className="rounded-3xl border border-cyan-500/20 bg-slate-950/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Detector</p>
          <p className="mt-2 text-xl font-semibold text-slate-100">
            {system.model?.name || (system.loading ? 'Loading...' : 'Unavailable')}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {system.model?.type || 'Model metadata unavailable'}
          </p>
        </div>
        <div className="rounded-3xl border border-cyan-500/20 bg-slate-950/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Training</p>
          <p className="mt-2 text-xl font-semibold text-slate-100">{trainingSummary}</p>
          <p className="mt-1 text-sm text-slate-400">
            {system.model?.trained ? 'Dataset-derived artifact loaded' : 'Trainer is ready, dataset is missing'}
          </p>
        </div>
        <div className="rounded-3xl border border-cyan-500/20 bg-slate-950/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Report Store</p>
          <p className="mt-2 text-xl font-semibold text-slate-100">{storageSummary}</p>
          <p className="mt-1 text-sm text-slate-400">
            {system.health?.reports?.store?.note || 'Storage metadata unavailable'}
          </p>
        </div>
      </section>

      <main className="mx-auto mt-8 w-full max-w-6xl">
        {activeTab === 'scan' ? <Scanner modelInfo={system.model} /> : <LiveMap />}
      </main>
    </div>
  )
}

export default App
