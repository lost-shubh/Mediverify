import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import api, { getApiErrorMessage } from '../lib/api.js'

const trail = [
  { label: 'Manufacturer', timestamp: '2026-02-27 08:14 IST', hash: '0xa7f4c3...9d12' },
  { label: 'Distributor', timestamp: '2026-02-27 18:42 IST', hash: '0x4e2b11...c07a' },
  { label: 'Pharmacy', timestamp: '2026-02-28 09:10 IST', hash: '0x8b91dd...fa33' },
]

const metricLabels = {
  brightness: 'Brightness',
  saturation: 'Saturation',
  sharpness: 'Sharpness',
  contrast: 'Contrast',
}

const initialReportState = {
  medicineName: '',
  description: '',
  lat: '',
  lng: '',
  manufacturerName: '',
  productNdc: '',
}

const getGeolocationMessage = (error) => {
  switch (error?.code) {
    case 1:
      return 'Location permission was denied. Enter coordinates manually if you have them.'
    case 2:
      return 'Your location could not be determined. Enter coordinates manually if you have them.'
    case 3:
      return 'Location lookup timed out. Enter coordinates manually if you have them.'
    default:
      return 'Location is unavailable right now. Enter coordinates manually if you have them.'
  }
}

const getScanState = (scanResult) => {
  const presentation = scanResult?.presentation || {}

  switch (presentation.tone) {
    case 'rose':
      return {
        title: presentation.title || 'Outside Known Baseline',
        shell: 'border-rose-400/40 bg-rose-500/10',
        copy: presentation.copy || 'The upload is outside the trained model envelope.',
      }
    case 'amber':
      return {
        title: presentation.title || 'Manual Review Required',
        shell: 'border-amber-400/40 bg-amber-500/10',
        copy: presentation.copy || 'The upload sits near the model boundary and needs human inspection.',
      }
    default:
      return {
        title: presentation.title || 'Within Known Baseline',
        shell: 'border-emerald-400/40 bg-emerald-500/10',
        copy:
          presentation.copy || 'The upload remains within the current model baseline.',
      }
  }
}

const getTotalSamples = (modelInfo) => {
  const directTotal = Number(modelInfo?.dataset?.totalSamples || 0)
  if (directTotal > 0) {
    return directTotal
  }

  const classTotal = Array.isArray(modelInfo?.dataset?.classes)
    ? modelInfo.dataset.classes.reduce(
        (total, entry) => total + Number(entry?.samples || 0),
        0
      )
    : 0

  if (classTotal > 0) {
    return classTotal
  }

  const authenticSamples = Number(modelInfo?.dataset?.authenticSamples || 0)
  const counterfeitSamples = Number(modelInfo?.dataset?.counterfeitSamples || 0)

  return authenticSamples + counterfeitSamples
}

const getFeatureProfileSummary = (modelInfo, metricKey) => {
  const classes = Array.isArray(modelInfo?.dataset?.classes) ? modelInfo.dataset.classes : []
  const profiles = modelInfo?.features?.[metricKey]?.profiles || {}
  const entries =
    classes.length > 0
      ? classes
      : Object.keys(profiles).map((key) => ({
          key,
          label: key,
        }))

  const parts = entries.flatMap((entry) => {
    const profile = profiles[entry.key]
    if (!profile || profile.mean === undefined || profile.mean === null) {
      return []
    }

    return [`${entry.label}: ${profile.mean}`]
  })

  return parts.length > 0 ? parts.join(' | ') : 'Profile means unavailable'
}

const formatSignalProfiles = (signal) => {
  const parts = Array.isArray(signal?.profileMeans)
    ? signal.profileMeans.map((profile) => `${profile.label} ${profile.mean}`)
    : []

  if (parts.length === 0) {
    return `Observed ${signal.value}`
  }

  return `Observed ${signal.value} | ${parts.join(' | ')}`
}

function Scanner({ modelInfo }) {
  const [preview, setPreview] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showReport, setShowReport] = useState(false)
  const [reportState, setReportState] = useState(initialReportState)
  const [reportStatus, setReportStatus] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [ndcResults, setNdcResults] = useState([])
  const [ndcLoading, setNdcLoading] = useState(false)
  const [ndcError, setNdcError] = useState('')

  useEffect(() => {
    if (!showReport) return

    const query = reportState.medicineName.trim()
    if (query.length < 2) {
      setNdcResults([])
      setNdcError('')
      return
    }

    let active = true
    const timer = setTimeout(async () => {
      try {
        setNdcLoading(true)
        setNdcError('')

        const response = await api.get('/api/ndc/search', {
          params: { query },
        })

        if (!active) return

        setNdcResults(Array.isArray(response.data.results) ? response.data.results : [])
        setNdcError(typeof response.data.error === 'string' ? response.data.error : '')
      } catch (requestError) {
        if (!active) return

        setNdcResults([])
        setNdcError(
          getApiErrorMessage(
            requestError,
            'Unable to search the FDA NDC directory right now.'
          )
        )
      } finally {
        if (active) {
          setNdcLoading(false)
        }
      }
    }, 400)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [reportState.medicineName, showReport])

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview)
      }
    }
  }, [preview])

  const reportStatusClass = useMemo(() => {
    if (!reportStatus) return 'text-slate-300'
    if (reportStatus.startsWith('Report submitted')) return 'text-emerald-200'
    if (reportStatus.startsWith('Submitting')) return 'text-cyan-200'
    return 'text-amber-200'
  }, [reportStatus])

  const modelSummary = useMemo(() => {
    if (!modelInfo) return null

    const totalSamples = getTotalSamples(modelInfo)
    const sampleLabel =
      modelInfo.decisionMode === 'profile-envelope' ? 'baseline images' : 'labeled images'

    return {
      name: modelInfo.name,
      type: modelInfo.type,
      trainingState: modelInfo.trained
        ? `${totalSamples} ${sampleLabel}`
        : 'No labeled dataset loaded',
      trainedAt: modelInfo.trainedAt,
      limitations: Array.isArray(modelInfo.limitations) ? modelInfo.limitations.slice(0, 2) : [],
    }
  }, [modelInfo])

  const onDrop = useCallback(
    async (acceptedFiles) => {
      try {
        const file = acceptedFiles[0]
        if (!file) return

        if (!file.type.startsWith('image/')) {
          setError('Please upload a JPG, PNG, WEBP, or GIF image.')
          return
        }

        if (file.size > 8 * 1024 * 1024) {
          setError('Image is too large. Please use an image under 8MB.')
          return
        }

        if (preview) {
          URL.revokeObjectURL(preview)
        }

        setPreview(URL.createObjectURL(file))
        setScanResult(null)
        setError('')
        setLoading(true)

        const formData = new FormData()
        formData.append('image', file)

        const response = await api.post('/api/scan', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })

        setScanResult(response.data)
      } catch (requestError) {
        setError(
          getApiErrorMessage(
            requestError,
            'Scan failed. Please try a clearer image.'
          )
        )
      } finally {
        setLoading(false)
      }
    },
    [preview]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
  })

  const statusCard = useMemo(() => {
    if (!scanResult) return null

    const scanState = getScanState(scanResult)

    return (
      <div className={`animate-fade-scale rounded-2xl border p-5 shadow-lg ${scanState.shell}`}>
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">{scanState.title}</h3>
            <p className="mt-1 text-sm text-slate-200">{scanState.copy}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3 text-sm">
            <p className="text-slate-300">Confidence</p>
            <p className="text-2xl font-semibold text-slate-50">{scanResult.confidence}%</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm">
            <p className="text-slate-300">
              {scanResult.scoreLabel || scanResult.presentation?.scoreLabel || 'Score'}
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-50">
              {scanResult.scorePercent ?? '--'}%
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm">
            <p className="text-slate-300">Model</p>
            <p className="mt-1 text-sm font-semibold text-slate-50">
              {scanResult.model?.name || 'Unknown detector'}
            </p>
            {scanResult.closestProfile?.label && (
              <p className="mt-1 text-xs text-slate-300">
                Closest profile: {scanResult.closestProfile.label}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-300">Batch ID: {scanResult.batchId}</p>
          </div>
        </div>
        {scanResult.issues?.length > 0 && (
          <ul className="mt-4 list-disc pl-5 text-sm text-slate-100">
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
    setNdcError('')

    if (!next) {
      setNdcResults([])
      return
    }

    if (!navigator.geolocation) {
      setReportStatus(
        'Location is unavailable in this browser. Enter coordinates manually if you have them.'
      )
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setReportState((prev) => ({
          ...prev,
          lat: pos.coords.latitude.toFixed(5),
          lng: pos.coords.longitude.toFixed(5),
        }))
      },
      (geoError) => {
        setReportStatus(getGeolocationMessage(geoError))
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,
      }
    )
  }

  const submitReport = async (event) => {
    event.preventDefault()

    const medicineName = reportState.medicineName.trim()
    if (!medicineName) {
      setReportStatus('Medicine name is required.')
      return
    }

    setReportSubmitting(true)
    setReportStatus('Submitting report...')

    try {
      await api.post('/api/report', {
        lat: reportState.lat || undefined,
        lng: reportState.lng || undefined,
        medicineName,
        manufacturerName: reportState.manufacturerName,
        productNdc: reportState.productNdc,
        description: reportState.description,
      })

      setReportStatus('Report submitted. Thank you for helping keep patients safe.')
      setReportState((prev) => ({
        ...initialReportState,
        lat: prev.lat,
        lng: prev.lng,
      }))
      setNdcResults([])
      setNdcError('')
    } catch (requestError) {
      setReportStatus(
        getApiErrorMessage(
          requestError,
          'Failed to submit report. Please try again.'
        )
      )
    } finally {
      setReportSubmitting(false)
    }
  }

  const showNdcEmptyState =
    showReport &&
    reportState.medicineName.trim().length >= 2 &&
    !ndcLoading &&
    !ndcError &&
    ndcResults.length === 0

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="space-y-6 rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-6 shadow-2xl">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Scan Medicine</h2>
          <p className="mt-2 text-sm text-slate-300">
            Upload a photo of the blister pack or bottle. MedVerify extracts a visual
            fingerprint and scores it against the current baseline model artifact.
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

        {loading && <p className="text-sm text-cyan-200">Extracting image features...</p>}
        {error && <p className="text-sm text-rose-200">{error}</p>}
        {statusCard}

        {scanResult?.featureSignals?.length > 0 && (
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300/70">
                Feature Contributions
              </h3>
              <span className="text-xs text-slate-400">
                {scanResult.presentation?.featureHint ||
                  'Higher percentages mean the feature is farther away from the current model baseline.'}
              </span>
            </div>
            <div className="mt-4 space-y-4">
              {scanResult.featureSignals.map((signal) => (
                <div key={signal.feature} className="rounded-2xl border border-cyan-400/10 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{signal.label}</p>
                      <p className="text-xs text-slate-400">{signal.description}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-100">
                      {signal.signalPercent}% {signal.signalLabel || 'signal'}
                    </span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-800">
                    <div
                      className={`h-2 rounded-full ${
                        signal.signalPercent >= 56
                          ? 'bg-rose-400'
                          : signal.signalPercent >= 35
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.max(signal.signalPercent, 6)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {formatSignalProfiles(signal)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300/70">
            Blockchain Trail
          </h3>
          <div className="mt-3 space-y-3 text-sm">
            {trail.map((step) => (
              <div key={step.label} className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-100">{step.label} verified</p>
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
                {ndcLoading && <p className="mt-2 text-xs text-cyan-200">Searching FDA NDC...</p>}
                {ndcError && <p className="mt-2 text-xs text-amber-200">{ndcError}</p>}
                {ndcResults.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-cyan-400/20 bg-slate-950/90 text-xs text-slate-200">
                    {ndcResults.map((item) => (
                      <button
                        type="button"
                        key={`${item.productNdc}-${item.brandName || item.genericName}`}
                        onClick={() =>
                          setReportState((prev) => ({
                            ...prev,
                            medicineName:
                              item.brandName || item.genericName || prev.medicineName,
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
                          {item.manufacturerName || 'Unknown manufacturer'} - NDC{' '}
                          {item.productNdc || 'n/a'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showNdcEmptyState && (
                  <p className="mt-2 text-xs text-slate-400">
                    No FDA NDC matches were found for that query yet.
                  </p>
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
                placeholder="Describe what looked unusual..."
                className="mt-2 w-full rounded-xl border border-cyan-400/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-300 focus:outline-none"
              />
            </label>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <button
                type="submit"
                disabled={reportSubmitting}
                className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-500/60"
              >
                {reportSubmitting ? 'Submitting...' : 'Submit Report'}
              </button>
              {reportStatus && <p className={`text-xs ${reportStatusClass}`}>{reportStatus}</p>}
            </div>
          </form>
        )}
      </section>

      <section className="space-y-5 rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-6 shadow-2xl">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Model Overview</h2>
          <p className="mt-2 text-sm text-slate-300">
            The deployed API exposes the exact model artifact it is using, including
            dataset labels, feature weights, and training status.
          </p>
        </div>

        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Model Card</p>
          <p className="mt-2 text-lg font-semibold text-slate-100">
            {modelSummary?.name || 'Loading model metadata...'}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Type</p>
              <p className="mt-2 text-sm text-slate-100">{modelSummary?.type || '--'}</p>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Training State</p>
              <p className="mt-2 text-sm text-slate-100">{modelSummary?.trainingState || '--'}</p>
            </div>
          </div>
          {modelSummary?.trainedAt && (
            <p className="mt-3 text-xs text-slate-400">
              Trained at: {new Date(modelSummary.trainedAt).toLocaleString()}
            </p>
          )}
          {modelSummary?.limitations?.length > 0 && (
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
              {modelSummary.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(metricLabels).map(([metricKey, metricLabel]) => (
            <div
              key={metricKey}
              className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4 text-sm"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">{metricLabel}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-100">
                {scanResult ? scanResult.metrics?.[metricKey] ?? '--' : '--'}
              </p>
              <p className="text-xs text-slate-400">
                {getFeatureProfileSummary(modelInfo, metricKey)}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900/70 to-slate-950/90 p-5 text-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Hackathon Note</p>
          <p className="mt-2 text-slate-300">
            This deployment exposes its real visual scoring stack. The model artifact
            itself declares whether it is running baseline matching or binary screening;
            there is no hidden end-to-end deep-learning classifier behind this UI.
          </p>
        </div>
      </section>
    </div>
  )
}

export default Scanner
