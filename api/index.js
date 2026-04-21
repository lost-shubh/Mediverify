let cachedApp = null

const getApp = () => {
  if (!cachedApp) {
    cachedApp = require('../server/index')
  }

  return cachedApp
}

module.exports = (req, res) => {
  try {
    const requestUrl = new URL(typeof req?.url === 'string' ? req.url : '/api', 'http://localhost')
    const rewrittenPath = requestUrl.searchParams.get('path')

    if (rewrittenPath) {
      requestUrl.searchParams.delete('path')

      const normalizedPath = rewrittenPath
        .split('/')
        .filter(Boolean)
        .join('/')

      req.url = normalizedPath ? `/api/${normalizedPath}` : '/api'

      const queryString = requestUrl.searchParams.toString()
      if (queryString) {
        req.url += `?${queryString}`
      }
    }

    return getApp()(req, res)
  } catch (error) {
    console.error('api bootstrap error', error)

    if (res?.headersSent) {
      return
    }

    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        error: 'API bootstrap failed.',
        details: error?.message || String(error),
      })
    )
  }
}
