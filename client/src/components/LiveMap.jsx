import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'

const API_BASE = import.meta.env.DEV
  ? import.meta.env.VITE_API_BASE || 'http://localhost:3001'
  : import.meta.env.VITE_API_BASE || ''

const pulseIcon = L.divIcon({
  className: '',
  html: '<div class="pulse-marker"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8],
})

function LiveMap() {
  const [features, setFeatures] = useState([])

  const fetchReports = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/reports`)
      setFeatures(response.data.features || [])
    } catch (error) {
      setFeatures([])
    }
  }

  useEffect(() => {
    fetchReports()
    const timer = setInterval(fetchReports, 10000)
    return () => clearInterval(timer)
  }, [])

  const stats = useMemo(() => {
    const total = features.length
    const cities = new Set()
    const medicineCounts = {}

    features.forEach((feature) => {
      const props = feature.properties || {}
      if (props.city) cities.add(props.city)
      if (props.medicineName) {
        medicineCounts[props.medicineName] = (medicineCounts[props.medicineName] || 0) + 1
      }
    })

    const mostFlagged = Object.entries(medicineCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

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
          <p>Live Threat Map</p>
          <span className="flex items-center gap-2 text-xs text-rose-200">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            Confirmed Counterfeit Reports
          </span>
        </div>

        <div className="h-[65vh] min-h-[420px] w-full">
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
                      {props.city || 'Unknown'} • {new Date(props.dateReported).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-200">{props.description}</p>
                  </Popup>
                </Marker>
              )
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

export default LiveMap
