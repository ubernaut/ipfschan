import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { config as baseConfig } from './config.js'
import { createIpfs } from './ipfs.js'
import { PostRepository } from './repository.js'
import { buildRouter } from './routes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function createApp({ dataDir, serveStatic = true, offline } = {}) {
  const resolvedDataDir = dataDir || baseConfig.dataDir
  const config = {
    ...baseConfig,
    dataDir: resolvedDataDir,
    indexFile: path.join(resolvedDataDir, path.basename(baseConfig.indexFile)),
    offline: offline ?? baseConfig.offline
  }

  const { helia, dag, files, blockstore } = await createIpfs({
    dataDir: config.dataDir,
    offline: config.offline
  })
  const repository = new PostRepository({
    indexPath: config.indexFile,
    dag,
    files,
    blockstore,
    dataDir: config.dataDir
  })
  await repository.init()

  const app = express()
  app.use(cors())
  app.use(express.json({ limit: config.maxBodyBytes }))

  app.use('/api', buildRouter(repository, config))

  if (serveStatic) {
    const distPath = path.join(__dirname, '..', '..', 'dist')
    app.use(express.static(distPath))
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distPath, 'index.html'), err => {
        if (err) next()
      })
    })
  }

  return { app, helia, repository, config }
}
