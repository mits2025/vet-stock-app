const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { startServer } = require('./index.cjs')

test('local server persists and reloads a clinic snapshot', async t => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vet-pos-server-'))
  const instance = startServer({ port: 0, dataDirectory })
  await new Promise(resolve => instance.server.once('listening', resolve))
  t.after(async () => {
    await new Promise(resolve => instance.server.close(resolve))
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  const port = instance.server.address().port
  const baseUrl = `http://127.0.0.1:${port}`
  const snapshot = { products: [{ id: 'p1', title: 'Test item' }], sales: [] }
  const saved = await fetch(`${baseUrl}/api/snapshot`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Vet-POS-Client': '1',
      Origin: baseUrl,
    },
    body: JSON.stringify({ snapshot }),
  })
  assert.equal(saved.status, 200)

  const loaded = await fetch(`${baseUrl}/api/snapshot`).then(response => response.json())
  assert.deepEqual(loaded.snapshot, snapshot)
})

test('local server rejects cross-origin snapshot writes', async t => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vet-pos-server-'))
  const instance = startServer({ port: 0, dataDirectory })
  await new Promise(resolve => instance.server.once('listening', resolve))
  t.after(async () => {
    await new Promise(resolve => instance.server.close(resolve))
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  const port = instance.server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/api/snapshot`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Vet-POS-Client': '1',
      Origin: 'https://example.com',
    },
    body: JSON.stringify({ snapshot: {} }),
  })
  assert.equal(response.status, 403)
})
