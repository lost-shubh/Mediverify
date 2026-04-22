import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import api, { getApiErrorMessage } from '../lib/api.js'

const pulseIcon = L.divIcon({
  className: '',
  html: '<div class="pulse-marker"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8],
})

const normalizeFeatures = (payload) => {
  const features = Array.isArray(payload?.features) ? payload.features : []

  return features.flatMap((feature) => {
    const coordinates = feature?.geometry?.coordinates
    const lng = Number.parseFloat(coordinates?.[0])
    const lat = Number.parseFloat(coordinates?.[1])

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return []
    }

    const properties = feature?.properties || {}

    return [
      {
        ...feature,
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        properties: {
          id: properties.id || `${lat}-${lng}-${properties.dateReported || 'report'}`,
          medicineName: properties.medicineName || 'Unknown medicine',
          manufacturerName: properties.manufacturerName || '',
          productNdc: properties.productNdc || '',
          description: properties.description || 'No description provided.',
          city: properties.city || 'Unknown',
          dateReported: properties.dateReported || '',
        },
      },
    ]
  })
}

const formatReportedAt = (value) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Time unknown'
  }

  return date.toLocaleString()
}

function LiveMap() {
  const [features, setFeatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const loadReports = async (preserveExisting = false) => {
      try {
        const response = await api.get('/api/reports')
        if (!active) return

        setFeatures(normalizeFeatures(response.data))
        setError('')
      } catch (requestError) {
        if (!active) return

        if (!preserveExisting) {
          setFeatures([])
        }

        setError(
          getApiErrorMessage(
            requestError,
            'Unable to load live reports right now.'
          )
        )
      } finally {
        if (active && !preserveExisting) {
          setLoading(false)
        }
      }
    }

    void loadReports(false)
    const timer = setInterval(() => {
      void loadReports(true)
    }, 10000)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const stats = useMemo(() => {
    const total = features.length
    const cities = new Set()
    const medicineCounts = {}

    features.forEach((feature) => {
      const props = feature.properties || {}

      if (props.city) {
        cities.add(props.city)
      }

      if (props.medicineName) {
        medicineCounts[props.medicineName] = (medicineCounts[props.medicineName] || 0) + 1
      }
    })

    const mostFlagged =
      Object.entries(medicineCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '--'

    return {
      total,
      cities: cities.size,
      mostFlagged,
    }
  }, [features])

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-5 md:grid-cols-3">
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Total Reports</p>
          <p className="mt-2 text-2xl font-semibold text-slate-100">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Cities Affected</p>
          <p className="mt-2 text-2xl font-semibold text-slate-100">{stats.cities}</p>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">
            Most Flagged Medicine
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-100">{stats.mostFlagged}</p>
        </div>
      </div>

      <div className="relative rounded-3xl border border-cyan-500/20 bg-slate-950/70 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between px-2 text-sm text-slate-300">
          <p>Live Report Map</p>
          <span className="flex items-center gap-2 text-xs text-rose-200">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            {loading ? 'Loading reports' : 'Flagged medicine reports'}
          </span>
        </div>
        {error && (
          <p className="mb-3 px-2 text-xs text-amber-200">{error}</p>
        )}

        <div className="relative h-[65vh] min-h-[420px] w-full">
          <MapContainer center={[20.5937, 78.9629]} zoom={5} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {features.map((feature) => {
              const [lng, lat] = feature.geometry.coordinates
              const props = feature.properties || {}

              return (
                <Marker key={props.id} position={[lat, lng]} icon={pulseIcon}>
                  <Popup>
                    <p className="text-sm font-semibold text-cyan-200">{props.medicineName}</p>
                    <p className="text-xs text-slate-300">
                      {props.city} - {formatReportedAt(props.dateReported)}
                    </p>
                    {(props.manufacturerName || props.productNdc) && (
                      <p className="text-[11px] text-slate-400">
                        {props.manufacturerName || 'Unknown manufacturer'}
                        {props.productNdc ? ` - NDC ${props.productNdc}` : ''}
                      </p>
                    )}
                    <p className="text-xs text-slate-200">{props.description}</p>
                  </Popup>
                </Marker>
              )
            })}
          </MapContainer>
          {!loading && features.length === 0 && (
            <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-2xl border border-dashed border-cyan-400/20 bg-slate-950/75 px-6 text-center text-sm text-slate-300">
              No medicine reports have been submitted yet. New reports will appear here automatically.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LiveMap
