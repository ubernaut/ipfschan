import { describe, expect, it } from 'vitest'
import {
  mergeCidLists,
  parseCidList,
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
})
