import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getPublicKeyAsync } from '@noble/ed25519'

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

const privateKey = randomBytes(32)
const publicKey = await getPublicKeyAsync(privateKey)
const privateKeyPath = resolve('licenses/private-key.hex')
const publicKeyPath = resolve('src/config/licensePublicKey.js')

await mkdir(dirname(privateKeyPath), { recursive: true })
await writeFile(privateKeyPath, `${bytesToHex(privateKey)}\n`, { flag: 'wx' })
await writeFile(
  publicKeyPath,
  `// Public Ed25519 key for offline license verification. Safe to bundle in the app.\nexport const LICENSE_PUBLIC_KEY_HEX = '${bytesToHex(publicKey)}'\n`
)

console.log(`Public key written to ${publicKeyPath}`)
console.log(`Private key written to ${privateKeyPath}`)
console.log('Keep licenses/private-key.hex secret. It is required to issue licenses.')
