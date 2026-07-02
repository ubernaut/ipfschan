import express from 'express'
import { CID } from 'multiformats/cid'

const PEER_TTL_MS = 2 * 60 * 1000

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function validPeerId(peerId) {
  return typeof peerId === 'string' && /^[a-zA-Z0-9_.:-]{8,128}$/.test(peerId)
}

function normalizeBoardCid(boardCid) {
  return CID.parse(boardCid).toString()
}

export function createP2PSignaling() {
  const router = express.Router()
  const peers = new Map()
  const providers = new Map()

  function cleanupPeer(peerId) {
    peers.delete(peerId)
    for (const [boardCid, boardProviders] of providers.entries()) {
      boardProviders.delete(peerId)
      if (boardProviders.size === 0) {
        providers.delete(boardCid)
      }
    }
  }

  function pruneProviders() {
    const cutoff = Date.now() - PEER_TTL_MS
    for (const [boardCid, boardProviders] of providers.entries()) {
      for (const [peerId, record] of boardProviders.entries()) {
        if (record.updatedAt < cutoff || !peers.has(peerId)) {
          boardProviders.delete(peerId)
        }
      }
      if (boardProviders.size === 0) {
        providers.delete(boardCid)
      }
    }
  }

  router.get('/signal/:peerId', (req, res) => {
    const { peerId } = req.params
    if (!validPeerId(peerId)) {
      res.status(400).json({ error: 'Invalid peer id' })
      return
    }

    const existing = peers.get(peerId)
    if (existing?.res) {
      existing.res.end()
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const keepAlive = setInterval(() => {
      sendEvent(res, 'ping', { now: Date.now() })
    }, 15000)

    peers.set(peerId, {
      res,
      keepAlive,
      connectedAt: Date.now()
    })
    sendEvent(res, 'ready', { peerId })

    req.on('close', () => {
      clearInterval(keepAlive)
      cleanupPeer(peerId)
    })
  })

  router.post('/providers', (req, res) => {
    try {
      const { peerId, boardCid } = req.body || {}
      if (!validPeerId(peerId)) {
        res.status(400).json({ error: 'Invalid peer id' })
        return
      }

      const normalizedBoardCid = normalizeBoardCid(boardCid)
      const boardProviders = providers.get(normalizedBoardCid) || new Map()
      boardProviders.set(peerId, {
        peerId,
        boardCid: normalizedBoardCid,
        updatedAt: Date.now()
      })
      providers.set(normalizedBoardCid, boardProviders)
      pruneProviders()

      res.json({
        ok: true,
        boardCid: normalizedBoardCid,
        peerId,
        online: peers.has(peerId)
      })
    } catch (err) {
      res.status(400).json({ error: err.message || 'Provider registration failed' })
    }
  })

  router.get('/providers/:boardCid', (req, res) => {
    try {
      const boardCid = normalizeBoardCid(req.params.boardCid)
      const exclude = req.query.exclude?.toString()
      pruneProviders()
      const boardProviders = providers.get(boardCid) || new Map()
      res.json({
        boardCid,
        providers: [...boardProviders.values()]
          .filter(provider => provider.peerId !== exclude && peers.has(provider.peerId))
          .map(provider => ({
            peerId: provider.peerId,
            updatedAt: provider.updatedAt
          }))
      })
    } catch (err) {
      res.status(400).json({ error: err.message || 'Provider lookup failed' })
    }
  })

  router.post('/signal/:peerId', (req, res) => {
    const { peerId } = req.params
    if (!validPeerId(peerId)) {
      res.status(400).json({ error: 'Invalid peer id' })
      return
    }

    const target = peers.get(peerId)
    if (!target?.res) {
      res.status(404).json({ error: 'Peer is not connected' })
      return
    }

    sendEvent(target.res, 'message', req.body || {})
    res.json({ ok: true })
  })

  return router
}
