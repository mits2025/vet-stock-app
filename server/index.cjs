const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_PORT = 4200
const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024
const projectRoot = path.resolve(__dirname, '..')
const webRoot = path.join(projectRoot, 'dist')

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function loadServerConfig() {
  const configPath = path.join(projectRoot, 'server-config.json')
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return {}
  }
}

function resolveOptions(overrides = {}) {
  const config = loadServerConfig()
  const configuredPort = Number(overrides.port ?? process.env.VET_POS_PORT ?? config.port ?? DEFAULT_PORT)
  const defaultDataDirectory = path.join(__dirname, 'data')
  const dataDirectory = path.resolve(overrides.dataDirectory ?? process.env.VET_POS_DATA_DIR ?? config.dataDirectory ?? defaultDataDirectory)

  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error('VET POS server port must be an integer from 0 to 65535.')
  }

  return { host: LOOPBACK_HOST, port: configuredPort, dataDirectory }
}

function openDatabase(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true })
  const database = new DatabaseSync(path.join(dataDirectory, 'vet-pos.sqlite'))
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS app_snapshots (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return database
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(payload)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_SNAPSHOT_BYTES) {
        reject(Object.assign(new Error('Snapshot is too large.'), { statusCode: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }))
      }
    })
    request.on('error', reject)
  })
}

function isSameOriginRequest(request) {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    const parsedOrigin = new URL(origin)
    return parsedOrigin.protocol === 'http:'
      && (parsedOrigin.hostname === '127.0.0.1' || parsedOrigin.hostname === 'localhost')
      && parsedOrigin.host === request.headers.host
  } catch {
    return false
  }
}

function createRequestHandler(database, port) {
  const loadSnapshot = database.prepare('SELECT value, updated_at FROM app_snapshots WHERE id = 1')
  const saveSnapshot = database.prepare(`
    INSERT INTO app_snapshots (id, value, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  return async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${LOOPBACK_HOST}:${port}`)

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return sendJson(response, 200, { ok: true, service: 'vet-pos-local', storage: 'sqlite' })
    }

    if (url.pathname === '/api/snapshot' && request.method === 'GET') {
      const row = loadSnapshot.get()
      if (!row) return sendJson(response, 200, { snapshot: null, updatedAt: null })
      try {
        return sendJson(response, 200, { snapshot: JSON.parse(row.value), updatedAt: row.updated_at })
      } catch {
        return sendJson(response, 500, { error: 'The saved clinic data is corrupted. Restore a known-good backup.' })
      }
    }

    if (url.pathname === '/api/snapshot' && request.method === 'PUT') {
      if (!isSameOriginRequest(request) || request.headers['x-vet-pos-client'] !== '1') {
        return sendJson(response, 403, { error: 'Request was not made by the local Vet POS app.' })
      }

      try {
        const body = await readJsonBody(request)
        if (!body || typeof body.snapshot !== 'object' || Array.isArray(body.snapshot)) {
          return sendJson(response, 400, { error: 'A clinic snapshot object is required.' })
        }
        const value = JSON.stringify(body.snapshot)
        if (Buffer.byteLength(value) > MAX_SNAPSHOT_BYTES) {
          return sendJson(response, 413, { error: 'Snapshot is too large.' })
        }
        const updatedAt = new Date().toISOString()
        database.exec('BEGIN IMMEDIATE TRANSACTION')
        try {
          saveSnapshot.run(value, updatedAt)
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
        return sendJson(response, 200, { saved: true, updatedAt })
      } catch (error) {
        if (!response.headersSent) return sendJson(response, error.statusCode || 500, { error: error.message })
        return undefined
      }
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { error: 'Method not allowed.' })
    }

    const requestedPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
    let filePath = path.resolve(webRoot, requestedPath)
    if (!filePath.startsWith(`${webRoot}${path.sep}`) && filePath !== webRoot) {
      return sendJson(response, 404, { error: 'Not found.' })
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) filePath = path.join(webRoot, 'index.html')
    if (!fs.existsSync(filePath)) return sendJson(response, 503, { error: 'The Vet POS web build is missing.' })

    const stat = fs.statSync(filePath)
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    })
    if (request.method === 'HEAD') return response.end()
    fs.createReadStream(filePath).pipe(response)
  }
}

function startServer(overrides = {}) {
  const options = resolveOptions(overrides)
  const database = openDatabase(options.dataDirectory)
  const requestHandler = createRequestHandler(database, options.port)
  const server = http.createServer((request, response) => {
    Promise.resolve(requestHandler(request, response)).catch(error => {
      console.error('Vet POS request failed.', error)
      if (!response.headersSent) sendJson(response, 500, { error: 'The local server could not complete the request.' })
      else response.destroy()
    })
  })
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'))
  server.listen(options.port, options.host, () => {
    const address = server.address()
    console.log(`Vet POS local server running at http://${options.host}:${address.port}`)
    console.log(`Clinic data: ${options.dataDirectory}`)
  })
  server.on('close', () => database.close())
  return { server, database, ...options }
}

if (require.main === module) startServer()

module.exports = { DEFAULT_PORT, MAX_SNAPSHOT_BYTES, startServer }
