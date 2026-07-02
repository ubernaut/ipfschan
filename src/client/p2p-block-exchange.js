const PEER_ID_KEY = 'ipfschan.p2p.peerId'
const SIGNAL_TIMEOUT_MS = 20000
const BLOCK_TIMEOUT_MS = 60000
const CHUNK_SIZE = 48 * 1024
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
]

function randomPeerId() {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `browser-${id}`
}

function getPeerId() {
  const existing = localStorage.getItem(PEER_ID_KEY)
  if (existing) return existing
  const peerId = randomPeerId()
  localStorage.setItem(PEER_ID_KEY, peerId)
  return peerId
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(promise, ms, message) {
  let timeoutId
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed (${res.status})`)
  }
  return res.json()
}

async function postJSON(url, body) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function waitForIceGathering(peerConnection) {
  if (peerConnection.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise(resolve => {
    const done = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        peerConnection.removeEventListener('icegatheringstatechange', done)
        resolve()
      }
    }
    peerConnection.addEventListener('icegatheringstatechange', done)
    setTimeout(resolve, 3000)
  })
}

function waitForOpen(channel) {
  if (channel.readyState === 'open') return Promise.resolve()
  return withTimeout(new Promise((resolve, reject) => {
    channel.addEventListener('open', resolve, { once: true })
    channel.addEventListener('error', () => reject(new Error('Data channel failed')), { once: true })
  }), SIGNAL_TIMEOUT_MS, 'Timed out waiting for peer data channel')
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function throttledSend(channel, payload) {
  channel.send(JSON.stringify(payload))
  if (channel.bufferedAmount > 1024 * 1024) {
    channel.bufferedAmountLowThreshold = 512 * 1024
    await new Promise(resolve => {
      channel.onbufferedamountlow = () => {
        channel.onbufferedamountlow = null
        resolve()
      }
    })
  }
}

class BlockChannel {
  constructor(channel, getBlockBytes, getFileBytes = null) {
    this.channel = channel
    this.getBlockBytes = getBlockBytes
    this.getFileBytes = getFileBytes
    this.pending = new Map()
    this.incoming = new Map()
    this.channel.addEventListener('message', event => {
      this.handleMessage(event.data).catch(() => {})
    })
  }

  async getBlock(cid) {
    return this.getBytes('get-block', cid, `Timed out waiting for block ${cid}`)
  }

  async getFile(cid) {
    return this.getBytes('get-file', cid, `Timed out waiting for file ${cid}`)
  }

  async getBytes(type, cid, timeoutMessage) {
    await waitForOpen(this.channel)
    const requestId = crypto.randomUUID()
    const promise = new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
    })
    await throttledSend(this.channel, { type, requestId, cid })
    return withTimeout(promise, BLOCK_TIMEOUT_MS, timeoutMessage)
  }

  async handleMessage(raw) {
    const message = JSON.parse(raw)
    if (message.type === 'get-block') {
      await this.sendBytes(message.requestId, message.cid, this.getBlockBytes, 'block')
      return
    }

    if (message.type === 'get-file') {
      await this.sendBytes(message.requestId, message.cid, this.getFileBytes, 'file')
      return
    }

    if (message.type === 'missing-block' || message.type === 'missing-file') {
      const pending = this.pending.get(message.requestId)
      if (pending) {
        this.pending.delete(message.requestId)
        pending.reject(new Error(message.error || `Missing ${message.cid}`))
      }
      return
    }

    if (message.type === 'block-start') {
      this.incoming.set(message.requestId, {
        cid: message.cid,
        chunks: [],
        expectedChunks: message.chunks
      })
      return
    }

    if (message.type === 'block-chunk') {
      const incoming = this.incoming.get(message.requestId)
      if (incoming) {
        incoming.chunks[message.index] = base64ToBytes(message.data)
      }
      return
    }

    if (message.type === 'block-end') {
      const incoming = this.incoming.get(message.requestId)
      const pending = this.pending.get(message.requestId)
      this.incoming.delete(message.requestId)
      this.pending.delete(message.requestId)
      if (!incoming || !pending) return
      const total = incoming.chunks.reduce((sum, chunk) => sum + (chunk?.byteLength || 0), 0)
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of incoming.chunks) {
        if (!chunk) {
          pending.reject(new Error(`Missing block chunk for ${incoming.cid}`))
          return
        }
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      pending.resolve(bytes)
    }
  }

  async sendBytes(requestId, cid, readBytes, resourceType) {
    try {
      if (!readBytes) {
        throw new Error(`Peer cannot serve ${resourceType} bytes`)
      }
      const bytes = await readBytes(cid)
      const chunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE))
      await throttledSend(this.channel, {
        type: 'block-start',
        requestId,
        cid,
        size: bytes.byteLength,
        chunks
      })
      for (let index = 0; index < chunks; index += 1) {
        const start = index * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, bytes.byteLength)
        await throttledSend(this.channel, {
          type: 'block-chunk',
          requestId,
          index,
          data: bytesToBase64(bytes.subarray(start, end))
        })
      }
      await throttledSend(this.channel, { type: 'block-end', requestId, cid })
    } catch (err) {
      await throttledSend(this.channel, {
        type: resourceType === 'file' ? 'missing-file' : 'missing-block',
        requestId,
        cid,
        error: err.message
      })
    }
  }
}

export class P2PBlockExchange {
  constructor({ getBlockBytes, getFileBytes = null, onStatus = () => {} }) {
    this.peerId = getPeerId()
    this.getBlockBytes = getBlockBytes
    this.getFileBytes = getFileBytes
    this.onStatus = onStatus
    this.events = null
    this.readyPromise = null
    this.pendingAnswers = new Map()
    this.connections = new Map()
  }

  async start() {
    if (this.readyPromise) return this.readyPromise

    this.readyPromise = new Promise((resolve, reject) => {
      const events = new EventSource(`/api/p2p/signal/${encodeURIComponent(this.peerId)}`)
      this.events = events
      const timeoutId = setTimeout(() => {
        reject(new Error('Timed out connecting to P2P signaling'))
      }, SIGNAL_TIMEOUT_MS)

      events.addEventListener('ready', () => {
        clearTimeout(timeoutId)
        this.onStatus(`peer ready: ${this.peerId}`)
        resolve(this.peerId)
      })

      events.addEventListener('message', event => {
        this.handleSignal(JSON.parse(event.data)).catch(err => {
          this.onStatus(err.message)
        })
      })

      events.addEventListener('error', () => {
        this.onStatus('P2P signaling disconnected')
      })
    })

    return this.readyPromise
  }

  async announce(boardCid) {
    await this.start()
    return postJSON('/api/p2p/providers', {
      peerId: this.peerId,
      boardCid
    })
  }

  async providers(boardCid) {
    await this.start()
    const params = new URLSearchParams({ exclude: this.peerId })
    const data = await fetchJSON(`/api/p2p/providers/${encodeURIComponent(boardCid)}?${params}`)
    return data.providers || []
  }

  async connect(provider) {
    const existing = this.connections.get(provider.peerId)
    if (existing?.channel?.channel?.readyState === 'open') {
      return existing.channel
    }

    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const dataChannel = peerConnection.createDataChannel('ipfschan-blocks', { ordered: true })
    const blockChannel = new BlockChannel(dataChannel, this.getBlockBytes, this.getFileBytes)
    const answerPromise = new Promise((resolve, reject) => {
      this.pendingAnswers.set(provider.peerId, { peerConnection, resolve, reject })
    })

    peerConnection.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
        this.connections.delete(provider.peerId)
      }
    })

    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    await waitForIceGathering(peerConnection)
    await postJSON(`/api/p2p/signal/${encodeURIComponent(provider.peerId)}`, {
      type: 'offer',
      from: this.peerId,
      offer: peerConnection.localDescription
    })

    await withTimeout(answerPromise, SIGNAL_TIMEOUT_MS, `Timed out waiting for peer ${provider.peerId}`)
    await waitForOpen(dataChannel)
    this.connections.set(provider.peerId, { peerConnection, channel: blockChannel })
    return blockChannel
  }

  async fetchBlockFromOpenPeers(cid) {
    return this.fetchFromOpenPeers(cid, connection => connection.channel.getBlock(cid), 'No open P2P block channels')
  }

  async fetchFileFromOpenPeers(cid) {
    return this.fetchFromOpenPeers(cid, connection => connection.channel.getFile(cid), 'No open P2P file channels')
  }

  async fetchFromOpenPeers(cid, fetcher, emptyMessage) {
    const errors = []
    for (const [peerId, connection] of this.connections.entries()) {
      if (connection.channel?.channel?.readyState !== 'open') continue
      try {
        return await fetcher(connection)
      } catch (err) {
        errors.push(`${peerId}: ${err.message}`)
      }
    }
    throw new Error(errors.length ? errors.join('; ') : emptyMessage)
  }

  async handleSignal(message) {
    if (message.type === 'offer') {
      await this.handleOffer(message)
      return
    }

    if (message.type === 'answer') {
      const pending = this.pendingAnswers.get(message.from)
      if (!pending) return
      this.pendingAnswers.delete(message.from)
      await pending.peerConnection.setRemoteDescription(message.answer)
      pending.resolve()
    }
  }

  async handleOffer(message) {
    await this.start()
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peerConnection.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
        this.connections.delete(message.from)
      }
    })

    peerConnection.addEventListener('datachannel', event => {
      const blockChannel = new BlockChannel(event.channel, this.getBlockBytes, this.getFileBytes)
      this.connections.set(message.from, { peerConnection, channel: blockChannel })
    })

    await peerConnection.setRemoteDescription(message.offer)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    await waitForIceGathering(peerConnection)
    await postJSON(`/api/p2p/signal/${encodeURIComponent(message.from)}`, {
      type: 'answer',
      from: this.peerId,
      answer: peerConnection.localDescription
    })
  }

  async close() {
    this.events?.close()
    this.events = null
    this.readyPromise = null
    for (const { peerConnection } of this.connections.values()) {
      peerConnection.close()
    }
    this.connections.clear()
    await wait(0)
  }
}
