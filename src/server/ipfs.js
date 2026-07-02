import { createHelia } from 'helia'
import { dagJson } from '@helia/dag-json'
import { unixfs } from '@helia/unixfs'
import { createLibp2p } from 'libp2p'
import { FsBlockstore } from 'blockstore-fs'
import { mkdir } from 'fs/promises'
import path from 'path'

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(message, params) {
      super(message, params)
      this.detail = params?.detail
    }
  }
}

export async function createIpfs({ dataDir, offline = false }) {
  const blockstorePath = path.join(dataDir, 'ipfs-blocks')
  await mkdir(blockstorePath, { recursive: true })
  const blockstore = new FsBlockstore(blockstorePath)

  let transports = []
  let connectionEncryption = []
  let streamMuxers = []

  if (!offline) {
    const { webSockets } = await import('@libp2p/websockets')
    const { tcp } = await import('@libp2p/tcp')
    const { noise } = await import('@libp2p/noise')
    const { yamux } = await import('@chainsafe/libp2p-yamux')
    transports = [tcp(), webSockets()]
    connectionEncryption = [noise()]
    streamMuxers = [yamux()]
  }

  const libp2p = await createLibp2p({
    transports,
    connectionEncryption,
    streamMuxers
  })

  const helia = await createHelia({
    blockstore,
    libp2p
  })

  return {
    helia,
    blockstore,
    dag: dagJson(helia),
    files: unixfs(helia)
  }
}
