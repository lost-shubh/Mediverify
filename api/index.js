const app = require('../server/index')

module.exports = (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost')
  const rewrittenPath = requestUrl.searchParams.get('path') || ''

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

  return app(req, res)
}
