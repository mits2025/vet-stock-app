const { app, ipcMain } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const path = require('node:path')

let database = null

function getDatabase() {
  if (database) return database
  database = new DatabaseSync(path.join(app.getPath('userData'), 'vet-pos.sqlite'))
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

function loadSnapshot() {
  const row = getDatabase().prepare('SELECT value FROM app_snapshots WHERE id = 1').get()
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    throw new Error('The desktop data snapshot is corrupted. Restore a known-good backup before continuing.')
  }
}

function saveSnapshot(snapshot) {
  const value = JSON.stringify(snapshot)
  if (value.length > 100 * 1024 * 1024) throw new Error('The clinic data snapshot is too large to save safely.')
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE TRANSACTION')
  try {
    db.prepare(`
      INSERT INTO app_snapshots (id, value, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(value, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { saved: true }
}

function setupStorage() {
  ipcMain.handle('storage:load-snapshot', loadSnapshot)
  ipcMain.handle('storage:save-snapshot', (_event, snapshot) => saveSnapshot(snapshot))
}

function closeStorage() {
  if (!database) return
  database.close()
  database = null
}

module.exports = { closeStorage, setupStorage }
