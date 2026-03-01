import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import axios from 'axios'

const API_BASE = import.meta.env.DEV
  ? import.meta.env.VITE_API_BASE || 'http://localhost:3001'
  : import.meta.env.VITE_API_BASE || ''

const trail = [
  { label: 'Manufacturer', timestamp: '2026-02-27 08:14 IST', hash: '0xa7f4c3...9d12' },
  { label: 'Distributor', timestamp: '2026-02-27 18:42 IST', hash: '0x4e2b11...c07a' },
  { label: 'Pharmacy', timestamp: '2026-02-28 09:10 IST', hash: '0x8b91dd...fa33' },
]

function Scanner() {
  const [preview, setPreview] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showReport, setShowReport] = useState(false)
  const [reportState, setReportState] = useState({
    medicineName: '',
    description: '',
    lat: '',
    lng: '',
    manufacturerName: '',
    productNdc: '',
  })
  const [reportStatus, setReportStatus] = useState('')
  const [ndcResults, setNdcResults] = useState([])
  const [ndcLoading, setNdcLoading] = useState(false)

  useEffect(() => {
    if (!showReport) return
    if (!reportState.medicineName) {
      setNdcResults([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        setNdcLoading(true)
        const response = await axios.get(`${API_BASE}/api/ndc/search`, {
          params: { query: reportState.medicineName },
        })
        setNdcResults(response.data.results || [])
      } catch (err) {
        setNdcResults([])
      } finally {
        setNdcLoading(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [reportState.medicineName, showReport])

  const onDrop = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0]
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setScanResult(null)
    setError('')
    setLoading(true)

    const formData = new FormData()
    formData.append('image', file)

    try {
      const response = await axios.post(`${API_BASE}/api/scan`, formData)
      setScanResult(response.data)
    } catch (err) {
      setError('Scan failed. Please try a clearer image.')
    } finally {
      setLoading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
  })

  const statusCard = useMemo(() => {
    if (!scanResult) return null
    const verified = scanResult.verified
    return (
      <div
        className={`animate-fade-scale rounded-2xl border p-5 shadow-lg ${
          verified
            ? 'border-emerald-400/40 bg-emerald-500/10'
            : 'border-rose-400/40 bg-rose-500/10'
        }`}
      >
        <h3 className="text-lg font-semibold">
          {verified ? '✅ GENUINE' : '⚠️ SUSPICIOUS'} - Confidence: {scanResult.confidence}%
        </h3>
        <p className="mt-1 text-sm text-slate-200">
          Batch ID: <span className="font-mono text-cyan-200">{scanResult.batchId}</span>
        </p>
        {!verified && (
          <ul className="mt-3 list-disc pl-5 text-sm text-rose-200">
            {scanResult.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }, [scanResult])

  const handleReportToggle = () => {
    const next = !showReport
    setShowReport(next)
    setReportStatus('')

    if (!next) return
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setReportState((prev) => ({
            ...prev,
            lat: pos.coords.latitude.toFixed(5),
            lng: pos.coords.longitude.toFixed(5),
          }))
        },
        () => {
          setReportStatus('Location permission denied. Please enter coordinates manually.')
        }
      )
    }
  }

  const submitReport = async (event) => {
    event.preventDefault()
    setReportStatus('Submitting report...')
    try {
      await axios.post(`${API_BASE}/api/report`, {
        lat: reportState.lat || undefined,
        lng: reportState.lng || undefined,
        medicineName: reportState.medicineName || 'Unknown Medicine',
        manufacturerName: reportState.manufacturerName,
        productNdc: reportState.productNdc,
        description: reportState.description,
      })
      setReportStatus('Report submitted. Thank you for helping keep patients safe.')
      setReportState((prev) => ({ ...prev, description: '' }))
    } catch (err) {
      const message =
        err?.response?.data?.error || 'Failed to submit report. Please try again.'
      setReportStatus(message)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="space-y-6 rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-6 shadow-2xl">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Scan Medicine</h2>
          <p className="mt-2 text-sm text-slate-300">
            Upload a photo of the blister pack or bottle. MedVerify checks the
            image fingerprint against a known genuine batch.
          </p>
        </div>

        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
            isDragActive
              ? 'border-cyan-300 bg-cyan-400/10'
              : 'border-cyan-400/30 bg-slate-900/60 hover:border-cyan-300'
          }`}
        >
          <input {...getInputProps()} />
          <div className="text-lg font-semibold text-cyan-200">Drop medicine image here</div>
          <p className="text-sm text-slate-300">or click to browse files</p>
        </div>

        {preview && (
          <div className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-900/70">
            <img src={preview} alt="Preview" className="max-h-72 w-full object-cover" />
          </div>
        )}

        {loading && <p className="text-sm text-cyan-200">Analyzing image fingerprint...</p>}
        {error && <p className="text-sm text-rose-200">{error}</p>}
        {statusCard}

        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300/70">
            Blockchain Trail
          </h3>
          <div className="mt-3 space-y-3 text-sm">
            {trail.map((step) => (
              <div key={step.label} className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-100">{step.label} ✅</p>
                  <p className="text-xs text-slate-400">{step.timestamp}</p>
                </div>
                <span className="rounded-full border border-cyan-400/30 px-3 py-1 font-mono text-xs text-cyan-200">
                  {step.hash}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <button
            onClick={handleReportToggle}
            className="rounded-full border border-cyan-400/40 bg-cyan-400/20 px-5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/30"
          >
            Report this Medicine
          </button>
          <span className="text-xs text-slate-400">
            Reports update the live threat map within seconds.
          </span>
        </div>

        {showReport && (
          <form
            onSubmit={submitReport}
            className="space-y-4 rounded-2xl border border-cyan-400/20 bg-slate-950/70 p-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-200">
                Medicine name
                <input
                  value={reportState.medicineName}
                  onChange={(event) =>
                    setReportState((prev) => ({
                      ...prev,
                      medicineName: event.target.value,
                      manufacturerName: '',
                      productNdc: '',
                    }))
                  }
                  placeholder="e.g. Paracet-500"
                  className="mt-2 w-full rounded-xl border border-cyan-400/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-300 focus:outline-none"
                  required
                />
                {ndcLoading && (
                  <p className="mt-2 text-xs text-cyan-200">Searching FDA NDC...</p>
                )}
                {ndcResults.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-cyan-400/20 bg-slate-950/90 text-xs text-slate-200">
                    {ndcResults.map((item) => (
                      <button
                        type="button"
                        key={`${item.productNdc}-${item.brandName}`}
                        onClick={() =>
                          setReportState((prev) => ({
                            ...prev,
                            medicineName: item.brandName || prev.medicineName,
                            manufacturerName: item.manufacturerName || '',
                            productNdc: item.productNdc || '',
                          }))
                        }
                        className="w-full border-b border-cyan-400/10 px-3 py-2 text-left hover:bg-cyan-400/10"
                      >
                        <div className="font-semibold text-slate-100">
                          {item.brandName || item.genericName}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {item.manufacturerName} · NDC {item.productNdc}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <label className="text-sm text-slate-200">
                Detected coordinates
                <div className="mt-2 flex gap-2">
                  <input
                    value={reportState.lat}
                    onChange={(event) =>
                      setReportState((prev) => ({ ...prev, lat: event.target.value }))
                    }
                    placeholder="Latitude"
                    className="w-full rounded-xl border border-cyan-400/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-300 focus:outline-none"
                  />
                  <input
                    value={reportState.lng}
                    onChange={(event) =>
                      setReportState((prev) => ({ ...prev, lng: event.target.value }))
                    }
                    placeholder="Longitude"
                    className="w-full rounded-xl border border-cyan-400/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-300 focus:outline-none"
                  />
                </div>
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-200">
                Manufacturer (FDA NDC)
                <input
                  value={reportState.manufacturerName}
                  readOnly
                  placeholder="Auto-filled from FDA database"
                  className="mt-2 w-full rounded-xl border border-cyan-400/20 bg-slate-900/40 px-3 py-2 text-sm text-slate-300"
                />
              </label>
              <label className="text-sm text-slate-200">
                Product NDC
                <input
                  value={reportState.productNdc}
                  readOnly
                  placeholder="Auto-filled"
                  className="mt-2 w-full rounded-xl border border-cyan-400/20 bg-slate-900/40 px-3 py-2 text-sm text-slate-300"
                />
              </label>
            </div>
            <label className="text-sm text-slate-200">
              Description
              <textarea
                value={reportState.description}
                onChange={(event) =>
                  setReportState((prev) => ({ ...prev, description: event.target.value }))
                }
                rows="3"
                placeholder="Describe what looked suspicious..."
                className="mt-2 w-full rounded-xl border border-cyan-400/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-300 focus:outline-none"
              />
            </label>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <button
                type="submit"
                className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
              >
                Submit Report
              </button>
              {reportStatus && <p className="text-xs text-slate-300">{reportStatus}</p>}
            </div>
          </form>
        )}
      </section>

      <section className="space-y-5 rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-6 shadow-2xl">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Fingerprint Metrics</h2>
          <p className="mt-2 text-sm text-slate-300">
            The scan highlights deviations from the genuine manufacturer imprint.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {['Brightness', 'Saturation', 'Sharpness'].map((metric) => (
            <div
              key={metric}
              className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4 text-sm"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">{metric}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-100">
                {scanResult ? scanResult.metrics?.[metric.toLowerCase()] ?? '--' : '--'}
              </p>
              <p className="text-xs text-slate-400">Reference batch fingerprint</p>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900/70 to-slate-950/90 p-5 text-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Risk Advisory</p>
          <p className="mt-2 text-slate-300">
            If any indicator spikes above the 15% deviation threshold, the batch is
            flagged for a manual inspection and immediate containment.
          </p>
        </div>
      </section>
    </div>
  )
}

export default Scanner
