import express from 'express'
import multer from 'multer'
import { config } from './config.js'
import { createP2PSignaling } from './p2p-signaling.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileBytes }
})

function parseTags(rawTags) {
  return Array.isArray(rawTags)
    ? rawTags
    : (rawTags || '').split(',').map(t => t.trim()).filter(Boolean)
}

function sendError(res, err, fallbackStatus = 400) {
  const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : fallbackStatus
  res.status(status).json({ error: err?.message || 'Request failed' })
}

function singleAttachment(req, res, next) {
  upload.single(config.uploadFieldName)(req, res, err => {
    if (err) {
      sendError(res, err, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      return
    }
    next()
  })
}

function mirrorUpload(req, res, next) {
  upload.any()(req, res, err => {
    if (err) {
      sendError(res, err, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      return
    }
    next()
  })
}

async function writeByteSource(res, source) {
  if (source && typeof source[Symbol.asyncIterator] === 'function') {
    for await (const chunk of source) {
      res.write(chunk)
    }
    return
  }
  if (source) {
    res.write(source)
  }
}

async function streamIpfsFile(repository, cidStr, res, mime = 'application/octet-stream') {
  res.setHeader('Content-Type', mime)

  try {
    const stream = repository.files.cat(cidStr)
    await writeByteSource(res, stream)
    res.end()
    return
  } catch (unixFsErr) {
    try {
      const { CID } = await import('multiformats/cid')
      const cid = CID.parse(cidStr)
      const blockOrGen = await repository.blockstore.get(cid)

      await writeByteSource(res, blockOrGen)
      res.end()
      return
    } catch (blockstoreErr) {
      console.error('UnixFS cat error:', unixFsErr)
      console.error('Blockstore fallback error:', blockstoreErr)
      throw unixFsErr
    }
  }
}

function parseMirrorSnapshot(req) {
  const raw = req.body?.snapshot
  if (!raw) {
    throw new Error('snapshot is required')
  }

  const snapshot = JSON.parse(raw)
  const attachments = (req.files || [])
    .filter(file => file.fieldname.startsWith('attachment:'))
    .map(file => ({
      cid: file.fieldname.slice('attachment:'.length),
      bytes: file.buffer,
      name: file.originalname,
      mime: file.mimetype,
      size: file.size
    }))

  return { ...snapshot, attachments }
}

export function buildRouter(repository, runtimeConfig = config) {
  const router = express.Router()
  router.use('/p2p', createP2PSignaling())

  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      status: 'ready',
      offline: runtimeConfig.offline,
      storage: 'local-ipfs',
      ...repository.getStats()
    })
  })

  router.get('/tags', (req, res) => {
    res.json(repository.getTags())
  })

  router.get('/tags/:tag/threads', (req, res) => {
    const threads = repository.getThreadsByTag(req.params.tag || '')
    res.json(threads)
  })

  router.get('/thread/:rootCid', (req, res) => {
    const data = repository.getThreadTree(req.params.rootCid)
    if (!data) {
      return res.status(404).json({ error: 'Thread not found' })
    }
    res.json(data)
  })

  router.post(
    '/thread',
    singleAttachment,
    async (req, res) => {
      try {
        const { title, body } = req.body

        const post = await repository.createThread({
          title,
          body,
          tags: parseTags(req.body.tags),
          attachment: req.file
        })
        res.status(201).json(post)
      } catch (err) {
        sendError(res, err)
      }
    }
  )

  router.post(
    '/thread/:parentCid/reply',
    singleAttachment,
    async (req, res) => {
      try {
        const post = await repository.replyToPost(req.params.parentCid, {
          title: req.body.title,
          body: req.body.body,
          attachment: req.file
        })
        res.status(201).json(post)
      } catch (err) {
        const status = err.message?.includes('not found') ? 404 : 400
        sendError(res, err, status)
      }
    }
  )

  router.post('/import', async (req, res) => {
    try {
      const { cid } = req.body
      if (!cid) {
        return res.status(400).json({ error: 'cid is required' })
      }
      const post = await repository.importPost(cid)
      res.status(201).json(post)
    } catch (err) {
      sendError(res, err)
    }
  })

  router.post('/p2p/mirror', mirrorUpload, async (req, res) => {
    try {
      const snapshot = parseMirrorSnapshot(req)
      const result = await repository.mirrorP2PBoard(snapshot)
      res.status(201).json(result)
    } catch (err) {
      sendError(res, err)
    }
  })

  router.get('/p2p/board/:boardCid', async (req, res) => {
    try {
      const snapshot = await repository.getP2PBoardSnapshot(req.params.boardCid)
      res.json(snapshot)
    } catch (err) {
      const status = err.message?.includes('Unsupported') ? 400 : 404
      sendError(res, err, status)
    }
  })

  router.get('/p2p/file/:cidStr', async (req, res) => {
    try {
      const mime = typeof req.query.mime === 'string' && req.query.mime
        ? req.query.mime
        : 'application/octet-stream'
      await streamIpfsFile(repository, req.params.cidStr, res, mime)
    } catch (err) {
      res.status(404).json({ error: 'File not found' })
    }
  })

  router.post('/reset', async (req, res) => {
    try {
      await repository.reset()
      res.json({ message: 'Database cleared' })
    } catch (err) {
      sendError(res, err, 500)
    }
  })

  router.get('/file/:cidStr', async (req, res) => {
    try {
      const cidStr = req.params.cidStr
      const meta = repository.findAttachmentMeta(cidStr)
      const mime = meta?.mime || 'application/octet-stream'
      await streamIpfsFile(repository, cidStr, res, mime)
    } catch (err) {
      res.status(404).json({ error: 'File not found' })
    }
  })

  return router
}
