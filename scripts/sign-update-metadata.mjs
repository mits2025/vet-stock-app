import { createHash, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const installerPath = process.argv[2] || path.join('release', `Vet-POS-Setup-${packageJson.version}.exe`)
const privateKey = `${process.env.UPDATE_METADATA_PRIVATE_KEY_PEM || ''}`.replace(/\\n/g, '\n').trim()
if (!privateKey) throw new Error('UPDATE_METADATA_PRIVATE_KEY_PEM is required.')

const installer = await readFile(installerPath)
const metadata = Buffer.from(JSON.stringify({
  version: packageJson.version,
  installer: path.basename(installerPath),
  sha256: createHash('sha256').update(installer).digest('hex'),
}))
const baseName = path.join(path.dirname(installerPath), `Vet-POS-Update-${packageJson.version}.json`)
await writeFile(baseName, metadata)
await writeFile(`${baseName}.sig`, sign(null, metadata, privateKey).toString('base64'))
