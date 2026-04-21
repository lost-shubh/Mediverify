import axios from 'axios'

const normalizeBaseUrl = (value) => {
  const trimmed = String(value || '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

const api = axios.create({
  baseURL: normalizeBaseUrl(import.meta.env.VITE_API_BASE),
  timeout: 20000,
})

export const getApiErrorMessage = (error, fallback) => {
  if (error?.code === 'ECONNABORTED') {
    return 'The request timed out. Please try again.'
  }

  const payload = error?.response?.data
  const candidates = [payload?.error, payload?.message, payload?.details]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
  }

  if (payload?.error && typeof payload.error === 'object') {
    try {
      return JSON.stringify(payload.error)
    } catch {
      return fallback
    }
  }

  return fallback
}

export default api
