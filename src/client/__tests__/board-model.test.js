import {
  BOARD_TYPE,
  emptyBoard,
  getTags,
  getThreadTree,
  getThreadsByTag,
  normalizeBoard,
  normalizeTags
} from '../board-model.js'

const posts = [
  {
    cid: 'root-a',
    parentCid: null,
    threadRootCid: 'root-a',
    title: 'older thread',
    body: 'root body',
    tags: ['alpha', 'shared'],
    createdAt: '2026-06-30T10:00:00.000Z'
  },
  {
    cid: 'reply-a-1',
    parentCid: 'root-a',
    threadRootCid: 'root-a',
    title: 'first reply',
    body: 'reply body',
    tags: ['alpha', 'shared'],
    createdAt: '2026-06-30T10:05:00.000Z'
  },
  {
    cid: 'reply-a-2',
    parentCid: 'reply-a-1',
    threadRootCid: 'root-a',
    title: 'nested reply',
    body: 'nested body',
    tags: ['alpha', 'shared'],
    createdAt: '2026-06-30T10:06:00.000Z'
  },
  {
    cid: 'root-b',
    parentCid: null,
    threadRootCid: 'root-b',
    title: 'newer thread',
    body: 'second root body',
    tags: ['alpha'],
    createdAt: '2026-06-30T10:01:00.000Z'
  },
  {
    cid: 'reply-b-1',
    parentCid: 'root-b',
    threadRootCid: 'root-b',
    title: 'activity bump',
    body: 'newer reply',
    tags: ['alpha'],
    createdAt: '2026-06-30T10:10:00.000Z'
  }
]

describe('browser board model', () => {
  it('normalizes tag input with lowercase uniqueness and a stable limit', () => {
    expect(normalizeTags([' Alpha ', 'alpha', 'BETA', '', 'gamma'])).toEqual([
      'alpha',
      'beta',
      'gamma'
    ])

    expect(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toHaveLength(8)
  })

  it('counts tags by posts in matching threads', () => {
    expect(getTags(posts)).toEqual([
      { tag: 'alpha', count: 5 },
      { tag: 'shared', count: 3 }
    ])
  })

  it('returns tag threads sorted by last activity', () => {
    const threads = getThreadsByTag(posts, 'alpha')

    expect(threads.map(thread => thread.rootCid)).toEqual(['root-b', 'root-a'])
    expect(threads[0]).toMatchObject({
      title: 'newer thread',
      postCount: 2,
      lastActivity: '2026-06-30T10:10:00.000Z'
    })
    expect(threads[1]).toMatchObject({
      title: 'older thread',
      postCount: 3,
      lastActivity: '2026-06-30T10:06:00.000Z'
    })
  })

  it('returns parent-before-child thread trees with depth metadata', () => {
    const thread = getThreadTree(posts, 'root-a')

    expect(thread.posts.map(post => [post.cid, post.depth, post.replyCount])).toEqual([
      ['root-a', 0, 1],
      ['reply-a-1', 1, 1],
      ['reply-a-2', 2, 0]
    ])
  })

  it('normalizes board manifests and rejects unsupported records', () => {
    const board = normalizeBoard({
      ...emptyBoard(),
      posts: ['root-a', 'root-a', 'reply-a-1']
    })

    expect(board.type).toBe(BOARD_TYPE)
    expect(board.posts).toEqual(['root-a', 'reply-a-1'])
    expect(() => normalizeBoard({ type: 'wrong-board/v1' })).toThrow('Unsupported thread index CID')
  })
})
