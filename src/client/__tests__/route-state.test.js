import { describe, expect, it } from 'vitest'
import {
  mergeCidLists,
  parseCidList,
  parseRecordList,
  sanitizeRouteRecord,
  serializeRecordList,
  serializeCidList
} from '../route-state.js'

describe('route reply CID state', () => {
  it('parses comma-separated CID hints with trimming and de-duplication', () => {
    expect(parseCidList(' reply-a,reply-b, reply-a ,, reply-c ')).toEqual([
      'reply-a',
      'reply-b',
      'reply-c'
    ])
  })

  it('parses multiple URL parameter values into one ordered list', () => {
    expect(parseCidList(['reply-a,reply-b', 'reply-c', 'reply-b'])).toEqual([
      'reply-a',
      'reply-b',
      'reply-c'
    ])
  })

  it('merges existing route hints with newly posted replies', () => {
    expect(mergeCidLists(['reply-a'], 'reply-b,reply-a', ['reply-c'])).toEqual([
      'reply-a',
      'reply-b',
      'reply-c'
    ])
  })

  it('serializes CID hints for stable shared thread URLs', () => {
    expect(serializeCidList(['reply-a', 'reply-b', 'reply-a'])).toBe('reply-a,reply-b')
  })

  it('round-trips verified route records with attachment metadata', () => {
    const records = [
      {
        cid: 'root-cid',
        parentCid: null,
        threadRootCid: 'root-cid',
        title: 'unicode ok',
        body: 'reply body with snowman \u2603',
        tags: ['Demo', 'demo', 'P2P'],
        createdAt: '2026-07-02T19:00:00.000Z',
        attachment: {
          cid: 'file-cid',
          name: 'image.png',
          mime: 'image/png',
          size: 42,
          blocks: ['file-cid', 'chunk-cid']
        },
        depth: 4,
        replyCount: 8
      }
    ]

    expect(parseRecordList(serializeRecordList(records))).toEqual([
      {
        cid: 'root-cid',
        parentCid: null,
        threadRootCid: 'root-cid',
        title: 'unicode ok',
        body: 'reply body with snowman \u2603',
        tags: ['demo', 'p2p'],
        createdAt: '2026-07-02T19:00:00.000Z',
        attachment: {
          cid: 'file-cid',
          name: 'image.png',
          mime: 'image/png',
          size: 42,
          blocks: ['file-cid', 'chunk-cid']
        }
      }
    ])
  })

  it('strips derived UI fields before serializing route records', () => {
    expect(sanitizeRouteRecord({
      cid: 'reply-cid',
      parentCid: 'root-cid',
      threadRootCid: 'root-cid',
      title: 'reply',
      body: 'body',
      tags: ['demo'],
      createdAt: '2026-07-02T19:01:00.000Z',
      depth: 2,
      replyCount: 3
    })).toEqual({
      cid: 'reply-cid',
      parentCid: 'root-cid',
      threadRootCid: 'root-cid',
      title: 'reply',
      body: 'body',
      tags: ['demo'],
      createdAt: '2026-07-02T19:01:00.000Z'
    })
  })

  it('ignores invalid route record payloads', () => {
    expect(parseRecordList('not-base64-json')).toEqual([])
    expect(parseRecordList(serializeRecordList([{ body: 'missing cid' }]))).toEqual([])
  })
})
