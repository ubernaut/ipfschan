import {
  emptyBoard,
  getTags,
  getThreadsByTag,
  getThreadTree,
  normalizeBoard,
  normalizeTags,
  sanitizeBody,
  sanitizeTitle
} from './board-model.js'
import {
  postPayloadFromRecord,
  postRecordFromPayload
} from '../shared/p2p-snapshot.js'
import { P2PBlockExchange } from './p2p-block-exchange.js'

const BOARD_STORAGE_KEY = 'ipfschan.p2p.boardCid'
const LOAD_TIMEOUT_MS = 8000
const PUBLIC_NETWORK_START_TIMEOUT_MS = 20000
const PUBLIC_LOAD_TIMEOUT_MS = 360000
const PUBLIC_LOAD_ATTEMPT_TIMEOUT_MS = 45000
const PUBLIC_LOAD_RETRY_DELAY_MS = 3000
const PUBLIC_ATTACHMENT_LOAD_TIMEOUT_MS = 240000
const PUBLIC_ATTACHMENT_ATTEMPT_TIMEOUT_MS = 45000
const PUBLIC_ATTACHMENT_RETRY_DELAY_MS = 3000
const PUBLIC_PROVIDE_TIMEOUT_MS = 180000
const PAGES_BUILD = import.meta.env?.MODE === 'pages'

export async function collect(source) {
  const resolved = typeof source?.then === 'function' ? await source : source
  if (resolved instanceof Uint8Array) return resolved
  if (resolved instanceof ArrayBuffer) return new Uint8Array(resolved)

  const chunks = []
  let totalLength = 0
  for await (const chunk of resolved) {
    const bytes = chunk instanceof Uint8Array
      ? chunk
      : chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : new Uint8Array([chunk])
    chunks.push(bytes)
    totalLength += bytes.byteLength
  }
  const output = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export function createPeerBackedBlockstore(baseBlockstore, fetchBlockBytes, onPeerError = () => {}) {
  return new Proxy(baseBlockstore, {
    get(target, prop, receiver) {
      if (prop === 'get') {
        return async (cid, options) => {
          try {
            return await collect(target.get(cid, options))
          } catch (localErr) {
            try {
              const bytes = await fetchBlockBytes(cid.toString())
              if (!(bytes instanceof Uint8Array)) {
                throw new Error(`Peer returned invalid block bytes for ${cid}`)
              }
              await target.put(cid, bytes, options)
              return bytes
            } catch (peerErr) {
              onPeerError(peerErr)
              throw peerErr.cause ? peerErr : new Error(peerErr.message, { cause: localErr })
            }
          }
        }
      }

      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

export async function collectLinkedBlockCids(blockstore, rootCidInput) {
  const [
    { CID },
    dagPb
  ] = await Promise.all([
    import('multiformats/cid'),
    import('@ipld/dag-pb')
  ])
  const rootCid = typeof rootCidInput === 'string'
    ? CID.parse(rootCidInput)
    : rootCidInput
  const seen = new Set()
  const cids = []

  const visit = async cid => {
    const cidString = cid.toString()
    if (seen.has(cidString)) return
    seen.add(cidString)
    cids.push(cidString)

    if (cid.code !== dagPb.code) return
    const bytes = await collect(blockstore.get(cid))
    const node = dagPb.decode(bytes)
    for (const link of node.Links || []) {
      if (link.Hash) {
        await visit(link.Hash)
      }
    }
  }

  await visit(rootCid)
  return cids
}

function withTimeout(promise, ms, message) {
  let timeoutId
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withAbortableTimeout(task, ms, message) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error(message)), ms)

  try {
    return await task(controller.signal)
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(message, { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export class DecentralizedBoard {
  constructor() {
    this.helia = null
    this.dag = null
    this.files = null
    this.board = emptyBoard()
    this.boardCid = null
    this.posts = []
    this.lastMirror = null
    this.lastMirrorError = null
    this.lastPeerError = null
    this.lastLoadSource = 'local'
    this.blockExchange = null
    this.peerFiles = null
    this.serverless = PAGES_BUILD
    this.publicNetwork = PAGES_BUILD
    this.publicNetworkReady = null
    this.publicNetworkStatus = PAGES_BUILD ? 'idle' : 'disabled'
    this.publicNetworkError = null
    this.lastPublicProvide = null
    this.lastPublicProvideError = null
    this.publicAnnouncePromise = null
    this.publicAnnounceToken = 0
  }

  async init() {
    if (this.helia) return

    const [
      { createHelia },
      { dagJson },
      { unixfs },
      { IDBBlockstore }
    ] = await Promise.all([
      import('helia'),
      import('@helia/dag-json'),
      import('@helia/unixfs'),
      import('blockstore-idb')
    ])

    const blockstore = new IDBBlockstore('ipfschan-browser-blocks')
    await blockstore.open()
    const heliaOptions = this.serverless
      ? { blockstore, start: false }
      : { blockstore }
    this.helia = await createHelia(heliaOptions)
    this.dag = dagJson(this.helia)
    this.files = unixfs(this.helia)
    if (this.serverless) {
      this.peerFiles = this.files
      this.startPublicNetwork()
      return
    }

    this.blockExchange = new P2PBlockExchange({
      getBlockBytes: cid => this.readBlockBytes(cid),
      getFileBytes: cid => this.readFileBytes(cid)
    })
    await this.blockExchange.start()
    this.peerFiles = unixfs({
      blockstore: createPeerBackedBlockstore(
        this.helia.blockstore,
        cid => this.blockExchange.fetchBlockFromOpenPeers(cid),
        err => {
          this.lastPeerError = err
        }
      )
    })
  }

  latestLocalBoardCid() {
    return localStorage.getItem(BOARD_STORAGE_KEY)
  }

  startPublicNetwork() {
    if (!this.publicNetwork || !this.helia) return null
    if (this.publicNetworkReady) return this.publicNetworkReady

    this.publicNetworkStatus = 'starting'
    this.publicNetworkError = null
    this.publicNetworkReady = this.helia.start()
      .then(() => {
        this.publicNetworkStatus = 'ready'
        this.publicNetworkError = null
        return true
      })
      .catch(err => {
        this.publicNetworkStatus = 'failed'
        this.publicNetworkError = err
        throw err
      })

    return this.publicNetworkReady
  }

  async waitForPublicNetwork(timeoutMs = PUBLIC_NETWORK_START_TIMEOUT_MS) {
    if (!this.publicNetwork) return null
    const ready = this.startPublicNetwork()
    if (!ready) return null
    return withTimeout(
      ready,
      timeoutMs,
      'Public IPFS relay startup timed out'
    )
  }

  publicNetworkSummary() {
    if (!this.publicNetwork) return null
    if (this.publicNetworkError) return this.publicNetworkError.message
    return this.publicNetworkStatus
  }

  notifyPublicAnnounce() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('ipfschan:public-announce', {
      detail: this.lastPublicProvide
    }))
  }

  notifyOperationProgress(detail) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('ipfschan:operation-progress', {
      detail
    }))
  }

  async newBoard() {
    await this.init()
    this.board = emptyBoard({ previousBoardCid: this.boardCid })
    this.boardCid = null
    this.posts = []
    return this.publish()
  }

  async resetLocalThreads() {
    await this.init()
    this.board = emptyBoard({ previousBoardCid: this.boardCid })
    this.boardCid = null
    this.posts = []
    this.lastLoadSource = 'local'
    this.lastPublicProvide = null
    this.lastPublicProvideError = null
    localStorage.removeItem(BOARD_STORAGE_KEY)
    return null
  }

  async load(boardCid) {
    await this.init()
    const { CID } = await import('multiformats/cid')
    const normalizedBoardCid = CID.parse(boardCid).toString()
    const localBoardCid = this.latestLocalBoardCid()

    if (this.serverless) {
      const expectedPublicLoad = localBoardCid !== normalizedBoardCid
      if (localBoardCid !== normalizedBoardCid) {
        try {
          await this.waitForPublicNetwork()
        } catch (err) {
          this.publicNetworkError = err
        }
      }

      try {
        await this.loadFromPublicHelia(normalizedBoardCid)
        if (expectedPublicLoad) {
          this.lastLoadSource = 'public'
        }
        return this.boardCid
      } catch (err) {
        this.lastLoadSource = 'public'
        const reason = this.publicNetworkError?.message || err.message
        throw new Error(`Thread index CID is not reachable through public IPFS: ${reason}`)
      }
    }

    if (localBoardCid !== normalizedBoardCid) {
      try {
        await this.loadFromPeers(normalizedBoardCid)
        return this.boardCid
      } catch (err) {
        this.lastPeerError = err
      }

      try {
        await this.loadFromMirror(normalizedBoardCid)
        return this.boardCid
      } catch (err) {
        this.lastLoadSource = 'network'
      }
    }

    try {
      await withTimeout(
        this.loadFromHelia(normalizedBoardCid),
        LOAD_TIMEOUT_MS,
        'Thread and tag blocks are not reachable from this browser yet'
      )
      return this.boardCid
    } catch (err) {
      try {
        await this.loadFromPeers(normalizedBoardCid)
        return this.boardCid
      } catch (peerErr) {
        this.lastPeerError = peerErr
      }
      await this.loadFromMirror(normalizedBoardCid)
      return this.boardCid
    }
  }

  async readBlockBytes(cidStr) {
    const { CID } = await import('multiformats/cid')
    return collect(this.helia.blockstore.get(CID.parse(cidStr)))
  }

  async readFileBytes(cidStr) {
    const { CID } = await import('multiformats/cid')
    return collect(this.files.cat(CID.parse(cidStr)))
  }

  async putBlockBytes(cidStr, bytes) {
    const { CID } = await import('multiformats/cid')
    const cid = CID.parse(cidStr)
    await this.helia.blockstore.put(cid, bytes)
  }

  async loadFromPublicHelia(boardCid) {
    const deadline = Date.now() + PUBLIC_LOAD_TIMEOUT_MS
    let lastErr = null

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      try {
        return await withAbortableTimeout(
          signal => this.loadFromHelia(boardCid, { signal }),
          Math.min(PUBLIC_LOAD_ATTEMPT_TIMEOUT_MS, remaining),
          'Thread and tag blocks are not reachable from public IPFS yet'
        )
      } catch (err) {
        lastErr = err
        if (Date.now() >= deadline) break
        await sleep(Math.min(PUBLIC_LOAD_RETRY_DELAY_MS, deadline - Date.now()))
      }
    }

    throw lastErr || new Error('Thread and tag blocks are not reachable from public IPFS yet')
  }

  async loadFromHelia(boardCid, options = {}) {
    const { CID } = await import('multiformats/cid')
    this.boardCid = CID.parse(boardCid).toString()
    this.notifyOperationProgress({
      kind: 'load',
      completed: 0,
      total: 1,
      message: 'updating tags and threads'
    })
    this.board = normalizeBoard(await this.dag.get(CID.parse(this.boardCid), options))
    this.posts = []
    const total = 1 + this.board.posts.length
    this.notifyOperationProgress({
      kind: 'load',
      completed: 1,
      total,
      message: 'updating tags and threads'
    })

    for (let index = 0; index < this.board.posts.length; index += 1) {
      const postCid = this.board.posts[index]
      const cid = CID.parse(postCid)
      const post = await this.dag.get(cid, options)
      this.posts.push(postRecordFromPayload(cid.toString(), post))
      this.notifyOperationProgress({
        kind: 'load',
        completed: index + 2,
        total,
        message: 'updating tags and threads',
        cid: postCid
      })
    }

    localStorage.setItem(BOARD_STORAGE_KEY, this.boardCid)
    this.lastLoadSource = 'local'
    await this.announceProvider()
    return this.boardCid
  }

  async loadFromPeers(boardCid) {
    await this.init()
    if (!this.blockExchange) {
      throw new Error('App signaling is unavailable in this serverless build')
    }

    this.lastPeerError = null
    const providers = await this.blockExchange.providers(boardCid)
    if (!providers.length) {
      throw new Error('No live P2P providers found')
    }

    const errors = []
    for (const provider of providers) {
      try {
        const connection = await this.blockExchange.connect(provider)
        const boardBytes = await connection.getBlock(boardCid)
        await this.putBlockBytes(boardCid, boardBytes)
        const { CID } = await import('multiformats/cid')
        const board = normalizeBoard(await this.dag.get(CID.parse(boardCid)))
        const attachmentCids = new Set()

        for (const postCid of board.posts) {
          const postBytes = await connection.getBlock(postCid)
          await this.putBlockBytes(postCid, postBytes)
          const post = await this.dag.get(CID.parse(postCid))
          if (post.attachment?.cid) {
            const blockCids = Array.isArray(post.attachment.blocks) && post.attachment.blocks.length
              ? post.attachment.blocks
              : [post.attachment.cid]
            for (const attachmentCid of blockCids) {
              attachmentCids.add(attachmentCid)
            }
          }
        }

        for (const attachmentCid of attachmentCids) {
          try {
            const attachmentBytes = await connection.getBlock(attachmentCid)
            await this.putBlockBytes(attachmentCid, attachmentBytes)
          } catch (err) {
            this.lastPeerError = err
          }
        }

        await this.loadFromHelia(boardCid)
        this.lastLoadSource = 'peer'
        await this.announceProvider()
        return this.boardCid
      } catch (err) {
        errors.push(`${provider.peerId}: ${err.message}`)
      }
    }

    throw new Error(`P2P providers failed: ${errors.join('; ')}`)
  }

  async loadFromMirror(boardCid) {
    const snapshot = await fetchJSON(`/api/p2p/board/${encodeURIComponent(boardCid)}`)
    await this.importSnapshot(snapshot)
    this.lastLoadSource = 'mirror'
    await this.announceProvider()
    return this.boardCid
  }

  async importSnapshot(snapshot) {
    await this.init()
    if (!snapshot?.boardCid || !snapshot?.board || !Array.isArray(snapshot.posts)) {
      throw new Error('Invalid board mirror snapshot')
    }

    const posts = []
    for (const post of snapshot.posts) {
      const payload = postPayloadFromRecord(post)
      const cid = await this.dag.add(payload)
      if (cid.toString() !== post.cid) {
        throw new Error(`Post CID mismatch for ${post.cid}`)
      }
      posts.push(postRecordFromPayload(post.cid, payload))
    }

    const board = normalizeBoard(snapshot.board)
    const boardCid = await this.dag.add(board)
    if (boardCid.toString() !== snapshot.boardCid) {
      throw new Error(`Board CID mismatch for ${snapshot.boardCid}`)
    }

    this.boardCid = boardCid.toString()
    this.board = board
    this.posts = posts
    localStorage.setItem(BOARD_STORAGE_KEY, this.boardCid)
    return this.boardCid
  }

  async publish() {
    await this.init()
    this.lastPublicProvide = null
    this.lastPublicProvideError = null
    const now = new Date().toISOString()
    this.board = normalizeBoard({
      ...this.board,
      updatedAt: now,
      posts: this.posts.map(post => post.cid)
    })
    const cid = await this.dag.add(this.board)
    this.boardCid = cid.toString()
    localStorage.setItem(BOARD_STORAGE_KEY, this.boardCid)
    await this.mirrorToServer()
    await this.announceProvider()
    this.queuePublicAnnounce()
    return this.boardCid
  }

  async createThread({ title, body, tags, attachment }) {
    await this.init()
    const normalizedTags = normalizeTags(tags)
    if (!normalizedTags.length) {
      throw new Error('At least one tag is required')
    }

    const attachmentInfo = await this.storeAttachment(attachment)
    const payload = {
      parentCid: null,
      threadRootCid: null,
      title: sanitizeTitle(title),
      body: sanitizeBody(body),
      tags: normalizedTags,
      createdAt: new Date().toISOString(),
      ...(attachmentInfo ? { attachment: attachmentInfo } : {})
    }
    const cid = await this.dag.add(payload)
    const record = {
      ...payload,
      cid: cid.toString(),
      threadRootCid: cid.toString()
    }
    this.posts.push(record)
    await this.publish()
    return record
  }

  async replyToPost(parentCid, { title, body, attachment }) {
    await this.init()
    const parent = this.posts.find(post => post.cid === parentCid)
    if (!parent) {
      throw new Error('Parent post not found in current board')
    }

    const attachmentInfo = await this.storeAttachment(attachment)
    const payload = {
      parentCid,
      threadRootCid: parent.threadRootCid || parent.cid,
      title: sanitizeTitle(title),
      body: sanitizeBody(body),
      tags: parent.tags || [],
      createdAt: new Date().toISOString(),
      ...(attachmentInfo ? { attachment: attachmentInfo } : {})
    }
    const cid = await this.dag.add(payload)
    const record = {
      ...payload,
      cid: cid.toString()
    }
    this.posts.push(record)
    await this.publish()
    return record
  }

  async storeAttachment(file) {
    if (!file || !file.size) return null
    const bytes = new Uint8Array(await file.arrayBuffer())
    const cid = await this.files.addBytes(bytes)
    let blocks = [cid.toString()]
    try {
      blocks = await collectLinkedBlockCids(this.helia.blockstore, cid)
    } catch (err) {
      this.lastPeerError = err
    }
    return {
      cid: cid.toString(),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      blocks
    }
  }

  getTags() {
    return getTags(this.posts)
  }

  getThreadsByTag(tag) {
    return getThreadsByTag(this.posts, tag)
  }

  getThreadTree(rootCid) {
    return getThreadTree(this.posts, rootCid)
  }

  async attachmentUrl(attachment) {
    if (!attachment?.cid) return null
    const { CID } = await import('multiformats/cid')
    try {
      const reader = this.peerFiles || this.files
      const bytes = await collect(reader.cat(CID.parse(attachment.cid)))
      const blob = new Blob([bytes], { type: attachment.mime || 'application/octet-stream' })
      return URL.createObjectURL(blob)
    } catch (err) {
      this.lastPeerError = err
      if (this.serverless && this.publicNetwork) {
        try {
          const bytes = await this.readAttachmentBytesFromPublicIpfs(attachment.cid)
          const blob = new Blob([bytes], { type: attachment.mime || 'application/octet-stream' })
          return URL.createObjectURL(blob)
        } catch (publicErr) {
          this.lastPeerError = publicErr
          throw new Error(`Attachment is not reachable through public IPFS yet: ${publicErr.message}`)
        }
      }

      if (!this.blockExchange) {
        throw new Error('Attachment is not reachable through public IPFS yet')
      }

      try {
        const bytes = await this.blockExchange.fetchFileFromOpenPeers(attachment.cid)
        const storedCid = await this.files.addBytes(bytes)
        if (storedCid.toString() !== attachment.cid) {
          throw new Error(`Peer attachment CID mismatch for ${attachment.cid}`)
        }
        const blob = new Blob([bytes], { type: attachment.mime || 'application/octet-stream' })
        return URL.createObjectURL(blob)
      } catch (peerErr) {
        this.lastPeerError = peerErr
      }
      const params = new URLSearchParams()
      if (attachment.mime) params.set('mime', attachment.mime)
      const suffix = params.toString() ? `?${params}` : ''
      return `/api/p2p/file/${encodeURIComponent(attachment.cid)}${suffix}`
    }
  }

  async readAttachmentBytesFromPublicIpfs(cidStr) {
    const { CID } = await import('multiformats/cid')
    const cid = CID.parse(cidStr)
    try {
      await this.waitForPublicNetwork()
    } catch (err) {
      this.publicNetworkError = err
    }

    const deadline = Date.now() + PUBLIC_ATTACHMENT_LOAD_TIMEOUT_MS
    let lastErr = null
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      try {
        return await withAbortableTimeout(
          signal => collect(this.files.cat(cid, { signal })),
          Math.min(PUBLIC_ATTACHMENT_ATTEMPT_TIMEOUT_MS, remaining),
          'Attachment bytes are not reachable from public IPFS yet'
        )
      } catch (err) {
        lastErr = err
        if (Date.now() >= deadline) break
        await sleep(Math.min(PUBLIC_ATTACHMENT_RETRY_DELAY_MS, deadline - Date.now()))
      }
    }

    throw lastErr || new Error('Attachment bytes are not reachable from public IPFS yet')
  }

  async announceProvider() {
    if (!this.boardCid || !this.blockExchange) return null
    try {
      return await this.blockExchange.announce(this.boardCid)
    } catch (err) {
      this.lastPeerError = err
      return null
    }
  }

  async provideCid(cidStr) {
    if (!this.publicNetwork || !cidStr) return null
    await this.waitForPublicNetwork()
    const { CID } = await import('multiformats/cid')
    const cid = CID.parse(cidStr)
    await withTimeout(
      this.helia.routing.provide(cid),
      PUBLIC_PROVIDE_TIMEOUT_MS,
      `Public IPFS provider announce timed out for ${cidStr}`
    )
    return cid.toString()
  }

  publicCidSet() {
    const cids = new Set()
    if (this.boardCid) cids.add(this.boardCid)
    for (const post of this.posts) {
      if (post.cid) cids.add(post.cid)
      if (post.attachment?.cid) {
        const attachmentCids = Array.isArray(post.attachment.blocks) && post.attachment.blocks.length
          ? post.attachment.blocks
          : [post.attachment.cid]
        for (const attachmentCid of attachmentCids) {
          cids.add(attachmentCid)
        }
      }
    }
    return [...cids]
  }

  queuePublicAnnounce() {
    this.lastPublicProvide = null
    this.lastPublicProvideError = null
    if (!this.publicNetwork || !this.boardCid) return null

    const token = this.publicAnnounceToken + 1
    this.publicAnnounceToken = token
    const cids = this.publicCidSet()
    this.lastPublicProvide = {
      attempted: cids.length,
      provided: 0,
      errors: [],
      pending: true,
      token,
      startedAt: new Date().toISOString()
    }
    this.notifyPublicAnnounce()
    this.notifyOperationProgress({
      kind: 'announce',
      completed: 0,
      total: cids.length,
      message: 'advertising thread availability to public IPFS',
      keepOpen: true
    })

    this.publicAnnouncePromise = this.announcePublicCids(cids, token)
      .catch(err => {
        if (token !== this.publicAnnounceToken) {
          return this.lastPublicProvide
        }
        this.lastPublicProvide = {
          attempted: cids.length,
          provided: 0,
          errors: [err.message],
          pending: false,
          token,
          startedAt: this.lastPublicProvide?.startedAt,
          finishedAt: new Date().toISOString()
        }
        this.lastPublicProvideError = err
        return this.lastPublicProvide
      })
      .finally(() => {
        if (token === this.publicAnnounceToken) {
          this.notifyPublicAnnounce()
        }
      })

    return this.publicAnnouncePromise
  }

  async announcePublicCids(cids = this.publicCidSet(), token = this.publicAnnounceToken) {
    if (!this.publicNetwork || !this.boardCid) return null

    const startedAt = this.lastPublicProvide?.startedAt || new Date().toISOString()
    let completed = 0
    let providedCount = 0
    const errors = []
    const results = await Promise.all(cids.map(async cid => {
      try {
        const provided = await this.provideCid(cid)
        providedCount += provided ? 1 : 0
        return { cid, provided }
      } catch (err) {
        errors.push(`${cid}: ${err.message}`)
        return { cid, error: err }
      } finally {
        completed += 1
        if (token === this.publicAnnounceToken) {
          this.lastPublicProvide = {
            attempted: cids.length,
            provided: providedCount,
            errors: [...errors],
            pending: completed < cids.length,
            token,
            startedAt
          }
          this.notifyPublicAnnounce()
          this.notifyOperationProgress({
            kind: 'announce',
            completed,
            total: cids.length,
            message: 'advertising thread availability to public IPFS',
            keepOpen: completed < cids.length
          })
        }
      }
    }))
    const provided = results
      .map(result => result.provided)
      .filter(Boolean)
    const finalErrors = results
      .filter(result => result.error)
      .map(result => `${result.cid}: ${result.error.message}`)

    if (token !== this.publicAnnounceToken) {
      return this.lastPublicProvide
    }

    this.lastPublicProvide = {
      attempted: provided.length + finalErrors.length,
      provided: provided.filter(Boolean).length,
      errors: finalErrors,
      pending: false,
      token,
      startedAt,
      finishedAt: new Date().toISOString()
    }
    this.lastPublicProvideError = finalErrors.length
      ? new Error(finalErrors.join('; '))
      : null
    return this.lastPublicProvide
  }

  async mirrorToServer() {
    this.lastMirror = null
    this.lastMirrorError = null
    if (this.serverless) return null

    try {
      const formData = new FormData()
      formData.append('snapshot', JSON.stringify({
        boardCid: this.boardCid,
        board: this.board,
        posts: this.posts
      }))

      const attachments = new Map()
      for (const post of this.posts) {
        if (post.attachment?.cid && !attachments.has(post.attachment.cid)) {
          attachments.set(post.attachment.cid, post.attachment)
        }
      }

      const { CID } = await import('multiformats/cid')
      for (const attachment of attachments.values()) {
        const bytes = await collect(this.files.cat(CID.parse(attachment.cid)))
        const blob = new Blob([bytes], { type: attachment.mime || 'application/octet-stream' })
        formData.append(`attachment:${attachment.cid}`, blob, attachment.name || attachment.cid)
      }

      this.lastMirror = await fetchJSON('/api/p2p/mirror', {
        method: 'POST',
        body: formData
      })
      return this.lastMirror
    } catch (err) {
      this.lastMirrorError = err
      return null
    }
  }
}

export const decentralizedBoard = new DecentralizedBoard()
