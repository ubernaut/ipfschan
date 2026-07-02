import { describe, expect, it } from 'vitest'
import { DecentralizedBoard } from '../decentralized-board.js'

function boardWithDag(cidByTitle = {}) {
  const board = new DecentralizedBoard()
  board.dag = {
    async add(payload) {
      return {
        toString: () => cidByTitle[payload.title] || payload.threadRootCid || 'unknown-cid'
      }
    }
  }
  return board
}

describe('decentralized board peer record import', () => {
  it('imports verified peer records for the expected thread', async () => {
    const board = boardWithDag({
      root: 'root-cid',
      reply: 'reply-cid'
    })

    const imported = await board.importThreadRecords([
      {
        cid: 'root-cid',
        parentCid: null,
        threadRootCid: 'root-cid',
        title: 'root',
        body: 'root body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:00:00.000Z'
      },
      {
        cid: 'reply-cid',
        parentCid: 'root-cid',
        threadRootCid: 'root-cid',
        title: 'reply',
        body: 'reply body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:01:00.000Z'
      }
    ], 'root-cid')

    expect(imported).toBe(2)
    expect(board.threadRecords('root-cid').map(post => post.cid)).toEqual([
      'root-cid',
      'reply-cid'
    ])
  })

  it('advertises both the current thread index and thread roots for live peers', () => {
    const board = new DecentralizedBoard()
    board.boardCid = 'index-cid'
    board.posts = [
      {
        cid: 'root-cid',
        parentCid: null,
        threadRootCid: 'root-cid',
        title: 'root',
        body: 'root body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:00:00.000Z'
      },
      {
        cid: 'reply-cid',
        parentCid: 'root-cid',
        threadRootCid: 'root-cid',
        title: 'reply',
        body: 'reply body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:01:00.000Z'
      }
    ]

    expect(board.providerCidSet()).toEqual(['index-cid', 'root-cid'])
  })

  it('rejects peer records whose computed CID does not match the claimed CID', async () => {
    const board = boardWithDag({
      reply: 'actual-reply-cid'
    })

    await expect(board.importThreadRecords([
      {
        cid: 'claimed-reply-cid',
        parentCid: 'root-cid',
        threadRootCid: 'root-cid',
        title: 'reply',
        body: 'reply body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:01:00.000Z'
      }
    ], 'root-cid')).rejects.toThrow('Peer post CID mismatch')
    expect(board.posts).toEqual([])
  })

  it('rejects peer records that belong to another thread', async () => {
    const board = boardWithDag({
      reply: 'reply-cid'
    })

    await expect(board.importThreadRecords([
      {
        cid: 'reply-cid',
        parentCid: 'other-root',
        threadRootCid: 'other-root',
        title: 'reply',
        body: 'reply body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:01:00.000Z'
      }
    ], 'root-cid')).rejects.toThrow('belongs to another thread')
    expect(board.posts).toEqual([])
  })

  it('rolls back a peer batch when a later record fails validation', async () => {
    const board = boardWithDag({
      root: 'root-cid',
      reply: 'reply-cid'
    })

    await expect(board.importThreadRecords([
      {
        cid: 'root-cid',
        parentCid: null,
        threadRootCid: 'root-cid',
        title: 'root',
        body: 'root body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:00:00.000Z'
      },
      {
        cid: 'reply-cid',
        parentCid: 'other-root',
        threadRootCid: 'other-root',
        title: 'reply',
        body: 'reply body',
        tags: ['p2p'],
        createdAt: '2026-07-02T18:01:00.000Z'
      }
    ], 'root-cid')).rejects.toThrow('belongs to another thread')
    expect(board.posts).toEqual([])
  })
})
