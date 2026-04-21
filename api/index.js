let cachedApp = null

const getApp = () => {
  if (!cachedApp) {
    cachedApp = require('../server/index')
  }

  return cachedApp
}

module.exports = (req, res) => {
  try {
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
