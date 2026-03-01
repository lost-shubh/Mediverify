const express = require('express')
const cors = require('cors')
const multer = require('multer')
const sharp = require('sharp')
const { v4: uuidv4 } = require('uuid')
const path = require('path')
const fs = require('fs')
const os = require('os')

const app = express()
const PORT = process.env.PORT || 3001

const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'medverify-uploads')
  : path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const upload = multer({ dest: uploadDir })

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json({ limit: '2mb' }))

const referenceFingerprint = {
  brightness: 0.62,
  saturation: 0.48,
}

const reports = [
  {
    id: uuidv4(),
    lat: 28.6139,
    lng: 77.209,
    city: 'New Delhi',
    medicineName: 'Paracet-500',
    description: 'Packaging seal looked tampered and pills were uneven.',
    dateReported: '2026-02-20T10:12:00.000Z',
  },
  {
    id: uuidv4(),
    lat: 19.076,
    lng: 72.8777,
    city: 'Mumbai',
    medicineName: 'AmoxiSafe',
    description: 'Blister pack color was faded and batch code missing.',
    dateReported: '2026-02-22T08:45:00.000Z',
  },
  {
    id: uuidv4(),
    lat: 12.9716,
    lng: 77.5946,
    city: 'Bengaluru',
    medicineName: 'CoughEase',
    description: 'QR scan failed; printing quality looked off.',
    dateReported: '2026-02-23T13:30:00.000Z',
  },
  {
    id: uuidv4(),
    lat: 22.5726,
    lng: 88.3639,
    city: 'Kolkata',
    medicineName: 'Paracet-500',
    description: 'Hologram sticker missing; pills had unusual odor.',
    dateReported: '2026-02-25T17:05:00.000Z',
  },
  {
    id: uuidv4(),
    lat: 13.0827,
    lng: 80.2707,
    city: 'Chennai',
    medicineName: 'VitaPlus',
    description: 'Capsules looked inconsistent in color.',
    dateReported: '2026-02-26T09:20:00.000Z',
  },
]

const ndcSearch = async (query) => {
  const term = String(query || '').trim()
  if (!term) return []

  const search = `brand_name:"${term}" OR generic_name:"${term}" OR product_ndc:"${term}"`
  const url = `https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(search)}&limit=5`

  const response = await fetch(url)
  if (!response.ok) return []
  const data = await response.json()
  return (data.results || []).map((item) => ({
    brandName: item.brand_name,
    genericName: item.generic_name,
    manufacturerName: item.labeler_name,
    productNdc: item.product_ndc,
    dosageForm: item.dosage_form,
    route: Array.isArray(item.route) ? item.route.join(', ') : item.route,
  }))
}

const toHsl = (r, g, b) => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  }
  return { saturation: s, lightness: l }
}

app.post('/api/scan', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required.' })
    }

    const filePath = req.file.path
    const stats = await sharp(filePath).stats()
    const [r, g, b] = stats.channels.slice(0, 3).map((ch) => ch.mean)

    const brightness = (r + g + b) / (3 * 255)
    const { saturation } = toHsl(r, g, b)

    const sharpStats = await sharp(filePath).greyscale().stats()
    const sharpness = sharpStats.channels[0].stdev

    const issues = []
    const brightnessDeviation = Math.abs(brightness - referenceFingerprint.brightness) / referenceFingerprint.brightness
    const saturationDeviation = Math.abs(saturation - referenceFingerprint.saturation) / referenceFingerprint.saturation

    if (brightnessDeviation > 0.15) {
      issues.push('Brightness deviates from genuine batch fingerprint.')
    }
    if (saturationDeviation > 0.15) {
      issues.push('Color saturation mismatch detected.')
    }
    if (sharpness < 8) {
      issues.push('Image appears unusually soft; label print may be low quality.')
    }

    const verified = issues.length === 0
    const confidence = Math.max(40, 87 - issues.length * 12)
    const batchId = `MFG-2024-${Math.floor(10 + Math.random() * 89)}`

    res.json({
      verified,
      confidence,
      issues,
      batchId,
      metrics: {
        brightness: Number(brightness.toFixed(3)),
        saturation: Number(saturation.toFixed(3)),
        sharpness: Number(sharpness.toFixed(2)),
      },
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to process image.' })
  }
})

app.post('/api/report', (req, res) => {
  const { lat, lng, medicineName, description, city, manufacturerName, productNdc } = req.body || {}

  if (typeof lat !== 'number' || typeof lng !== 'number' || !medicineName) {
    return res.status(400).json({ error: 'lat, lng, and medicineName are required.' })
  }

  const report = {
    id: uuidv4(),
    lat,
    lng,
    city: city || 'Unknown',
    medicineName,
    manufacturerName: manufacturerName || '',
    productNdc: productNdc || '',
    description: description || '',
    dateReported: new Date().toISOString(),
  }

  reports.unshift(report)
  res.json({ status: 'ok', report })
})

app.get('/api/ndc/search', async (req, res) => {
  try {
    const results = await ndcSearch(req.query.query)
    res.json({ results })
  } catch (error) {
    res.json({ results: [] })
  }
})

app.get('/api/reports', (req, res) => {
  res.json({
    type: 'FeatureCollection',
    features: reports.map((report) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [report.lng, report.lat],
      },
      properties: {
        id: report.id,
        medicineName: report.medicineName,
        manufacturerName: report.manufacturerName,
        productNdc: report.productNdc,
        description: report.description,
        city: report.city,
        dateReported: report.dateReported,
      },
    })),
  })
})

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`MedVerify server running on http://localhost:${PORT}`)
  })
}

module.exports = app
