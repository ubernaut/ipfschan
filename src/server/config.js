import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.resolve(__dirname, '../..')
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data')

function envNumber(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function envBool(name, fallback) {
  const value = process.env[name]
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

export const config = {
  port: envNumber('PORT', 4000),
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  dataDir: DATA_DIR,
  indexFile: path.join(DATA_DIR, 'index.json'),
  uploadFieldName: 'attachment',
  maxBodyBytes: envNumber('MAX_BODY_BYTES', 1024 * 1024 * 2),
  maxFileBytes: envNumber('MAX_FILE_BYTES', 1024 * 1024 * 25),
  https: envBool('HTTPS', false),
  httpsKeyFile: process.env.HTTPS_KEY_FILE || process.env.SSL_KEY_FILE || '',
  httpsCertFile: process.env.HTTPS_CERT_FILE || process.env.SSL_CERT_FILE || '',
  // Default to offline to avoid network interface calls in restricted environments.
  offline: envBool('IPFS_OFFLINE', true)
}
