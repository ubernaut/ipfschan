import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { mkdtempSync, rmSync } from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { once } from 'events'
import { createApp } from '../app.js'
import { createIpfs } from '../ipfs.js'
import { BOARD_TYPE } from '../../shared/p2p-snapshot.js'

let app
let helia
let dataDir
let sourceHelia
let sourceDataDir
let httpServer

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ipfschan-api-'))
  const created = await createApp({
    dataDir,
    serveStatic: false,
    offline: true
  })
  app = created.app
  helia = created.helia
})

afterEach(async () => {
  if (helia?.stop) {
    await helia.stop()
  }
  if (sourceHelia?.stop) {
    await sourceHelia.stop()
  }
  if (httpServer) {
    httpServer.close()
    await once(httpServer, 'close').catch(() => {})
  }
  rmSync(dataDir, { recursive: true, force: true })
  if (sourceDataDir) {
    rmSync(sourceDataDir, { recursive: true, force: true })
  }
  sourceHelia = null
  sourceDataDir = null
  httpServer = null
})

describe('API routes', () => {
  it('reports health and index counts', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(200)

    expect(res.body).toMatchObject({
      ok: true,
      status: 'ready',
      offline: true,
      postCount: 0,
      threadCount: 0,
      tagCount: 0
    })
  })

  it('creates a thread, replies, lists tags, streams files, and resets the index', async () => {
    const threadRes = await request(app)
      .post('/api/thread')
      .field('title', 'Deploy smoke')
      .field('body', 'Root post')
      .field('tags', 'deploy, smoke')
      .attach('attachment', Buffer.from('hello deploy'), {
        filename: 'hello.txt',
        contentType: 'text/plain'
      })
      .expect(201)

    expect(threadRes.body.cid).toBeTruthy()
    expect(threadRes.body.attachment.cid).toBeTruthy()

    const replyRes = await request(app)
      .post(`/api/thread/${encodeURIComponent(threadRes.body.cid)}/reply`)
      .field('title', 'Reply')
      .field('body', 'Reply body')
      .expect(201)

    const tagsRes = await request(app)
      .get('/api/tags')
      .expect(200)

    expect(tagsRes.body[0]).toMatchObject({ tag: 'deploy', count: 2 })

    const threadsRes = await request(app)
      .get('/api/tags/deploy/threads')
      .expect(200)

    expect(threadsRes.body).toHaveLength(1)
    expect(threadsRes.body[0]).toMatchObject({
      rootCid: threadRes.body.cid,
      postCount: 2
    })

    const treeRes = await request(app)
      .get(`/api/thread/${encodeURIComponent(threadRes.body.cid)}`)
      .expect(200)

    expect(treeRes.body.posts.map(post => post.cid)).toEqual([
      threadRes.body.cid,
      replyRes.body.cid
    ])
    expect(treeRes.body.posts.map(post => post.depth)).toEqual([0, 1])

    const fileRes = await request(app)
      .get(`/api/file/${encodeURIComponent(threadRes.body.attachment.cid)}`)
      .expect(200)

    expect(fileRes.headers['content-type']).toContain('text/plain')
    expect(fileRes.text).toBe('hello deploy')

    await request(app)
      .post('/api/reset')
      .expect(200)

    const healthRes = await request(app)
      .get('/api/health')
      .expect(200)

    expect(healthRes.body.postCount).toBe(0)
    expect(healthRes.body.threadCount).toBe(0)
  })

  it('imports a reply CID from local IPFS blocks after the index is reset', async () => {
    const threadRes = await request(app)
      .post('/api/thread')
      .field('title', 'Import root')
      .field('body', 'Root post')
      .field('tags', 'import')
      .expect(201)

    const replyRes = await request(app)
      .post(`/api/thread/${encodeURIComponent(threadRes.body.cid)}/reply`)
      .field('body', 'Reply to import')
      .expect(201)

    await request(app)
      .post('/api/reset')
      .expect(200)

    const importRes = await request(app)
      .post('/api/import')
      .send({ cid: replyRes.body.cid })
      .expect(201)

    expect(importRes.body.cid).toBe(replyRes.body.cid)
    expect(importRes.body.threadRootCid).toBe(threadRes.body.cid)

    const treeRes = await request(app)
      .get(`/api/thread/${encodeURIComponent(threadRes.body.cid)}`)
      .expect(200)

    expect(treeRes.body.posts.map(post => post.cid)).toEqual([
      threadRes.body.cid,
      replyRes.body.cid
    ])
  })

  it('mirrors and serves a P2P board snapshot by CID', async () => {
    sourceDataDir = mkdtempSync(path.join(tmpdir(), 'ipfschan-p2p-source-'))
    const source = await createIpfs({ dataDir: sourceDataDir, offline: true })
    sourceHelia = source.helia

    const attachmentBytes = Buffer.from('mirrored attachment')
    const attachmentCid = await source.files.addBytes(attachmentBytes)
    const createdAt = '2026-06-30T23:47:00.000Z'
    const rootPayload = {
      parentCid: null,
      threadRootCid: null,
      title: 'Mirrored P2P root',
      body: 'Browser-authored root',
      tags: ['p2p'],
      createdAt,
      attachment: {
        cid: attachmentCid.toString(),
        name: 'mirror.txt',
        mime: 'text/plain',
        size: attachmentBytes.length
      }
    }
    const rootCid = await source.dag.add(rootPayload)
    const rootRecord = {
      ...rootPayload,
      cid: rootCid.toString(),
      threadRootCid: rootCid.toString()
    }
    const board = {
      type: BOARD_TYPE,
      version: 1,
      createdAt,
      updatedAt: createdAt,
      previousBoardCid: null,
      posts: [rootCid.toString()]
    }
    const boardCid = await source.dag.add(board)

    const mirrorRes = await request(app)
      .post('/api/p2p/mirror')
      .field('snapshot', JSON.stringify({
        boardCid: boardCid.toString(),
        board,
        posts: [rootRecord]
      }))
      .attach(`attachment:${attachmentCid}`, attachmentBytes, {
        filename: 'mirror.txt',
        contentType: 'text/plain'
      })
      .expect(201)

    expect(mirrorRes.body).toMatchObject({
      boardCid: boardCid.toString(),
      postCount: 1,
      attachmentCount: 1
    })

    const snapshotRes = await request(app)
      .get(`/api/p2p/board/${encodeURIComponent(boardCid.toString())}`)
      .expect(200)

    expect(snapshotRes.body.boardCid).toBe(boardCid.toString())
    expect(snapshotRes.body.posts[0]).toMatchObject({
      cid: rootCid.toString(),
      threadRootCid: rootCid.toString(),
      title: 'Mirrored P2P root'
    })

    const fileRes = await request(app)
      .get(`/api/p2p/file/${encodeURIComponent(attachmentCid.toString())}`)
      .query({ mime: 'text/plain' })
      .expect(200)

    expect(fileRes.headers['content-type']).toContain('text/plain')
    expect(fileRes.text).toBe('mirrored attachment')
  })

  it('registers P2P providers and forwards signaling messages', async () => {
    httpServer = app.listen(0)
    await once(httpServer, 'listening')
    const { port } = httpServer.address()
    const baseUrl = `http://127.0.0.1:${port}`
    const abortController = new AbortController()
    const peerId = 'browser-test-peer-1'
    const boardCid = 'baguqeerajneouidcewpl4tkrmmlcovfhph6eht7gwwkaw7sffp2almewpwwa'
    const signalRes = await fetch(`${baseUrl}/api/p2p/signal/${peerId}`, {
      signal: abortController.signal
    })
    const reader = signalRes.body.getReader()
    const decoder = new TextDecoder()

    async function readUntil(pattern) {
      let text = ''
      for (let index = 0; index < 20; index += 1) {
        const { value } = await reader.read()
        text += decoder.decode(value)
        if (text.includes(pattern)) return text
      }
      throw new Error(`Did not receive ${pattern}`)
    }

    await readUntil('event: ready')

    const registerRes = await fetch(`${baseUrl}/api/p2p/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId, boardCid })
    })
    expect(registerRes.status).toBe(200)

    const providersRes = await fetch(`${baseUrl}/api/p2p/providers/${boardCid}`)
    const providers = await providersRes.json()
    expect(providers.providers).toEqual([
      expect.objectContaining({ peerId })
    ])

    const forwardRes = await fetch(`${baseUrl}/api/p2p/signal/${peerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'offer',
        from: 'browser-test-peer-2',
        offer: { type: 'offer', sdp: 'test' }
      })
    })
    expect(forwardRes.status).toBe(200)
    const forwarded = await readUntil('browser-test-peer-2')
    expect(forwarded).toContain('event: message')
    abortController.abort()
  })
})
