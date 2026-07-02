import { describe, expect, it } from 'vitest'
import {
  collect,
  collectLinkedBlockCids,
  createPeerBackedBlockstore
} from '../decentralized-board.js'
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

function cid(value) {
  return {
    toString: () => value
  }
}

function memoryBlockstore(entries = {}) {
  const blocks = new Map(
    Object.entries(entries).map(([key, value]) => [key, new Uint8Array(value)])
  )

  return {
    blocks,
    async get(blockCid) {
      const key = blockCid.toString()
      if (!blocks.has(key)) {
        throw new Error(`missing ${key}`)
      }
      return blocks.get(key)
    },
    async put(blockCid, bytes) {
      blocks.set(blockCid.toString(), bytes)
    },
    async has(blockCid) {
      return blocks.has(blockCid.toString())
    }
  }
}

describe('peer-backed blockstore', () => {
  it('collects Uint8Array and async iterable block bytes', async () => {
    expect([...await collect(new Uint8Array([1, 2, 3]))]).toEqual([1, 2, 3])

    async function* source() {
      yield new Uint8Array([4, 5])
      yield new Uint8Array([6])
    }

    expect([...await collect(source())]).toEqual([4, 5, 6])
  })

  it('serves local blocks without asking the peer', async () => {
    const local = memoryBlockstore({ local: [1, 2, 3] })
    let peerCalls = 0
    const blockstore = createPeerBackedBlockstore(local, async () => {
      peerCalls += 1
      return new Uint8Array([9])
    })

    expect([...await collect(blockstore.get(cid('local')))]).toEqual([1, 2, 3])
    expect(peerCalls).toBe(0)
  })

  it('fetches missing blocks from a peer and caches them locally', async () => {
    const local = memoryBlockstore()
    const remote = new Map([['remote', new Uint8Array([7, 8, 9])]])
    const blockstore = createPeerBackedBlockstore(local, async blockCid => {
      const bytes = remote.get(blockCid)
      if (!bytes) throw new Error(`peer missing ${blockCid}`)
      return bytes
    })

    expect([...await collect(blockstore.get(cid('remote')))]).toEqual([7, 8, 9])
    expect(await local.has(cid('remote'))).toBe(true)
    expect([...await collect(local.get(cid('remote')))]).toEqual([7, 8, 9])
  })

  it('fetches from a peer when the local blockstream fails during read', async () => {
    const blocks = new Map()
    const local = {
      async *get() {
        throw new Error('missing from async iterator')
      },
      async put(blockCid, bytes) {
        blocks.set(blockCid.toString(), bytes)
      }
    }
    const blockstore = createPeerBackedBlockstore(local, async blockCid => {
      if (blockCid !== 'late-miss') throw new Error(`peer missing ${blockCid}`)
      return new Uint8Array([4, 3, 2, 1])
    })

    expect([...await collect(blockstore.get(cid('late-miss')))]).toEqual([4, 3, 2, 1])
    expect([...blocks.get('late-miss')]).toEqual([4, 3, 2, 1])
  })

  it('walks DAG-PB links when collecting attachment block CIDs', async () => {
    const leafA = CID.create(1, raw.code, await sha256.digest(new Uint8Array([1, 2, 3])))
    const leafB = CID.create(1, raw.code, await sha256.digest(new Uint8Array([4, 5, 6])))
    const rootBytes = dagPb.encode({
      Data: new Uint8Array(),
      Links: [
        { Hash: leafA, Name: '0', Tsize: 3 },
        { Hash: leafB, Name: '1', Tsize: 3 },
        { Hash: leafA, Name: 'again', Tsize: 3 }
      ]
    })
    const root = CID.create(1, dagPb.code, await sha256.digest(rootBytes))
    const blockstore = memoryBlockstore({
      [root.toString()]: rootBytes
    })

    await expect(collectLinkedBlockCids(blockstore, root)).resolves.toEqual([
      root.toString(),
      leafA.toString(),
      leafB.toString()
    ])
  })
})
