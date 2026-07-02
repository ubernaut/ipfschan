import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dataDir = path.resolve(__dirname, '../data')

async function resetViaApi(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/reset`, { method: 'POST' })
    if (res.ok) {
      console.log(`Successfully reset database via API on port ${port}`)
      return true
    }
  } catch (err) {
    // Ignore connection errors
  }
  return false
}

async function main() {
  // Try to reset via API first (supports 4000 default and 6660 from user logs)
  const ports = [process.env.PORT, 6660, 4000].filter(Boolean)
  let apiSuccess = false

  for (const port of new Set(ports)) {
    if (await resetViaApi(port)) {
      apiSuccess = true
      break
    }
  }

  if (apiSuccess) {
    console.log('Note: Only the index was cleared via API. IPFS blocks remain on disk until server restart.')
    return
  }

  // If API failed, assume server is down and safe to delete files
  if (fs.existsSync(dataDir)) {
    console.log(`Removing data directory: ${dataDir}`)
    fs.rmSync(dataDir, { recursive: true, force: true })
    console.log('Data directory removed. Restart the server to initialize a fresh state.')
  } else {
    console.log('Data directory does not exist or already cleaned.')
  }
}

main().catch(console.error)
