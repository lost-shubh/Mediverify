const express = require('express')
const cors = require('cors')
const multer = require('multer')
const { randomUUID } = require('crypto')
const path = require('path')
const fs = require('fs')
const os = require('os')
const {
  extractImageMetrics,
  loadVisualModel,
  scoreMetrics,
} = require('./model/visualModel')

const app = express()
const PORT = process.env.PORT || 3001
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const DEFAULT_COORDINATES = { lat: 20.5937, lng: 78.9629 }
const OPENFDA_TIMEOUT_MS = Number.parseInt(process.env.OPENFDA_TIMEOUT_MS || '8000', 10)
const runtimeStartedAt = new Date()
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])
const visualModel = loadVisualModel()

const register = (method, paths, ...handlers) => {
  paths.forEach((routePath) => {
    app[method](routePath, ...handlers)
  })
}

const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'medverify-uploads')
  : path.join(__dirname, 'uploads')

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const sanitizeText = (value, { fallback = '', maxLength = 200 } = {}) => {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return fallback

  return trimmed.slice(0, maxLength)
}

const sanitizeCoordinate = (value, min, max, fallback) => {
  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback
  }

  return Number(parsed.toFixed(5))
}

const deleteUpload = async (file) => {
  if (!file?.path) return

  try {
    await fs.promises.unlink(file.path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('upload cleanup error', error)
    }
  }
}

const isInvalidImageError = (error) =>
  /unsupported image format|input buffer|input file/i.test(error?.message || '')

const upload = multer({
  storage: process.env.VERCEL
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
          cb(
            null,
            `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '')}`
          )
        },
      }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true)
      return
    }

    const error = new Error('Only JPG, PNG, WEBP, and GIF images are supported.')
    error.statusCode = 400
    cb(error)
  },
})

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

app.use(
  cors(
    process.env.VERCEL
      ? {}
      : {
          origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
              callback(null, true)
              return
            }

            callback(null, false)
          },
        }
  )
)
app.use(express.json({ limit: '2mb' }))

const seedReports = [
  {
    id: randomUUID(),
    lat: 28.6139,
    lng: 77.209,
    city: 'New Delhi',
    medicineName: 'Paracet-500',
    description: 'Packaging seal looked tampered and pills were uneven.',
    dateReported: '2026-02-20T10:12:00.000Z',
  },
  {
    id: randomUUID(),
    lat: 19.076,
    lng: 72.8777,
    city: 'Mumbai',
    medicineName: 'AmoxiSafe',
    description: 'Blister pack color was faded and batch code missing.',
    dateReported: '2026-02-22T08:45:00.000Z',
  },
  {
    id: randomUUID(),
    lat: 12.9716,
    lng: 77.5946,
    city: 'Bengaluru',
    medicineName: 'CoughEase',
    description: 'QR scan failed; printing quality looked off.',
    dateReported: '2026-02-23T13:30:00.000Z',
  },
  {
    id: randomUUID(),
    lat: 22.5726,
    lng: 88.3639,
    city: 'Kolkata',
    medicineName: 'Paracet-500',
    description: 'Hologram sticker missing; pills had unusual odor.',
    dateReported: '2026-02-25T17:05:00.000Z',
  },
  {
    id: randomUUID(),
    lat: 13.0827,
    lng: 80.2707,
    city: 'Chennai',
    medicineName: 'VitaPlus',
    description: 'Capsules looked inconsistent in color.',
    dateReported: '2026-02-26T09:20:00.000Z',
  },
]
const reports = [...seedReports]

const escapeOpenFdaTerm = (value) => value.replace(/["\\]/g, '\\$&')

const ndcSearch = async (query) => {
  const term = sanitizeText(query, { fallback: '', maxLength: 80 })
  if (term.length < 2) return []

  const escapedTerm = escapeOpenFdaTerm(term)
  const searchClauses = [
    `brand_name:"${escapedTerm}"`,
    `generic_name:"${escapedTerm}"`,
    `product_ndc:"${escapedTerm}"`,
  ]

  if (!escapedTerm.includes(' ')) {
    searchClauses.push(`brand_name:${escapedTerm}*`, `generic_name:${escapedTerm}*`)
  }

  const search = searchClauses.join(' OR ')
  const url = `https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(search)}&limit=5`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENFDA_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    })

    if (response.status === 404) {
      return []
    }

    if (!response.ok) {
      throw new Error(`openFDA request failed with status ${response.status}`)
    }

    const data = await response.json()

    return (data.results || []).map((item) => ({
      brandName: item.brand_name,
      genericName: item.generic_name,
      manufacturerName: item.labeler_name,
      productNdc: item.product_ndc,
      dosageForm: item.dosage_form,
      route: Array.isArray(item.route) ? item.route.join(', ') : item.route,
    }))
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('The FDA NDC lookup timed out.')
      timeoutError.statusCode = 504
      throw timeoutError
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

const getReportStore = () => ({
  type: 'memory',
  persistence: process.env.VERCEL ? 'ephemeral' : 'process-lifetime',
  note: process.env.VERCEL
    ? 'Reports can reset when the Vercel serverless instance is recycled.'
    : 'Reports reset when the local server process restarts.',
})

app.get('/api/health', (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - runtimeStartedAt.getTime()) / 1000)

  res.set('Cache-Control', 'no-store')
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL ? 'vercel' : 'local',
    uptimeSeconds,
    reports: {
      seeded: seedReports.length,
      current: reports.length,
      store: getReportStore(),
    },
    model: {
      name: visualModel.name,
      version: visualModel.version,
      type: visualModel.type,
      trained: Boolean(visualModel.trained),
    },
  })
})

app.get('/api/model-info', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({
    ...visualModel,
    reportStore: getReportStore(),
    runtime: {
      environment: process.env.VERCEL ? 'vercel' : 'local',
      apiMode: process.env.VERCEL ? 'serverless' : 'node-server',
    },
  })
})

const scanHandler = async (req, res) => {
  const uploadedFile = req.file
  try {
    if (!uploadedFile) {
      return res.status(400).json({ error: 'Image file is required.' })
    }

    const imageSource = uploadedFile.buffer || uploadedFile.path
    const metrics = await extractImageMetrics(imageSource)
    const result = scoreMetrics(metrics, visualModel)
    const batchId = `MFG-2024-${Math.floor(10 + Math.random() * 89)}`

    res.json({
      ...result,
      batchId,
      metrics,
    })
  } catch (error) {
    if (isInvalidImageError(error)) {
      return res.status(400).json({ error: 'Uploaded file is not a valid image.' })
    }

    console.error('scan error', error)
    res.status(500).json({ error: 'Failed to process image.', details: error.message })
  } finally {
    await deleteUpload(uploadedFile)
  }
}

register('post', ['/scan', '/api/scan'], upload.single('image'), scanHandler)

const reportHandler = (req, res) => {
  const { lat, lng, medicineName, description, city, manufacturerName, productNdc } = req.body || {}

  const safeLat = sanitizeCoordinate(lat, -90, 90, DEFAULT_COORDINATES.lat)
  const safeLng = sanitizeCoordinate(lng, -180, 180, DEFAULT_COORDINATES.lng)
  const safeMedicineName = sanitizeText(medicineName, { fallback: '', maxLength: 120 })

  if (!safeMedicineName) {
    return res.status(400).json({ error: 'medicineName is required.' })
  }

  const report = {
    id: randomUUID(),
    lat: safeLat,
    lng: safeLng,
    city: sanitizeText(city, { fallback: 'Unknown', maxLength: 80 }),
    medicineName: safeMedicineName,
    manufacturerName: sanitizeText(manufacturerName, { fallback: '', maxLength: 120 }),
    productNdc: sanitizeText(productNdc, { fallback: '', maxLength: 40 }),
    description: sanitizeText(description, { fallback: '', maxLength: 1000 }),
    dateReported: new Date().toISOString(),
  }

  reports.unshift(report)
  res.json({ status: 'ok', report })
}

register('post', ['/report', '/api/report'], reportHandler)

const ndcSearchHandler = async (req, res) => {
  try {
    const results = await ndcSearch(req.query.query)
    res.json({ results })
  } catch (error) {
    const statusCode = error.statusCode || 502
    res.status(statusCode).json({
      error: 'FDA NDC lookup is temporarily unavailable.',
      details: error.message,
      results: [],
    })
  }
}

register('get', ['/ndc/search', '/api/ndc/search'], ndcSearchHandler)

const reportsHandler = (req, res) => {
  res.set('Cache-Control', 'no-store')
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
}

register('get', ['/reports', '/api/reports'], reportsHandler)

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(400)
        .json({ error: 'Image is too large. Please upload an image under 8MB.' })
    }

    return res.status(400).json({ error: `Upload error: ${err.message}` })
  }

  if (err?.statusCode) {
    return res.status(err.statusCode).json({ error: err.message })
  }

  if (err) {
    console.error('server error', err)
    return res.status(500).json({ error: 'Server error.', details: err.message })
  }

  return next()
})

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`MedVerify server running on http://localhost:${PORT}`)
  })
}

module.exports = app
