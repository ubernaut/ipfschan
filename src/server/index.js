import { config } from './config.js'
import { createApp } from './app.js'
import http from 'http'
import https from 'https'
import { readFile } from 'fs/promises'

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function createServer(app, runtimeConfig) {
  if (!runtimeConfig.https) {
    return {
      protocol: 'http',
      server: http.createServer(app)
    }
  }

  if (!runtimeConfig.httpsKeyFile || !runtimeConfig.httpsCertFile) {
    throw new Error('HTTPS requires HTTPS_KEY_FILE and HTTPS_CERT_FILE')
  }

  const [key, cert] = await Promise.all([
    readFile(runtimeConfig.httpsKeyFile),
    readFile(runtimeConfig.httpsCertFile)
  ])

  return {
    protocol: 'https',
    server: https.createServer({ key, cert }, app)
  }
}

async function start() {
  const { app, helia, config: runtimeConfig } = await createApp()
  const { protocol, server } = await createServer(app, runtimeConfig)
  server.listen(runtimeConfig.port, runtimeConfig.host, () => {
    console.log(`API and web server running on ${protocol}://${runtimeConfig.host}:${runtimeConfig.port}`)
    console.log(`Data directory: ${runtimeConfig.dataDir}`)
  })

  let shuttingDown = false
  async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}; shutting down`)
    try {
      await closeServer(server)
      await helia.stop?.()
      process.exit(0)
    } catch (err) {
      console.error('Shutdown failed', err)
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start().catch(err => {
  console.error('Failed to start server', err)
  process.exit(1)
})
