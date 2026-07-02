import { BOARD_TYPE } from '../shared/p2p-snapshot.js'

export { BOARD_TYPE }

export function normalizeTags(tags) {
  const cleaned = (tags || [])
    .map(tag => tag.toString().trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(cleaned)].slice(0, 8)
}

export function sanitizeBody(body) {
  return (body || '').toString().slice(0, 5000)
}

export function sanitizeTitle(title) {
  return (title || '').toString().slice(0, 200)
}

export function emptyBoard({ previousBoardCid = null } = {}) {
  const now = new Date().toISOString()
  return {
    type: BOARD_TYPE,
    version: 1,
    createdAt: now,
    updatedAt: now,
    previousBoardCid,
    posts: []
  }
}

export function normalizeBoard(board) {
  if (!board || typeof board !== 'object' || board.type !== BOARD_TYPE) {
    throw new Error('Unsupported thread index CID')
  }
  return {
    ...board,
    posts: [...new Set(board.posts || [])]
  }
}

export function postTimestamp(post) {
  const time = Date.parse(post?.createdAt)
  return Number.isFinite(time) ? time : 0
}

export function comparePostsByCreatedAt(a, b) {
  const timeDelta = postTimestamp(a) - postTimestamp(b)
  if (timeDelta !== 0) return timeDelta
  return (a?.cid || '').localeCompare(b?.cid || '')
}

export function threadRootForPost(post) {
  return post.parentCid ? post.threadRootCid : post.cid
}

export function buildThreadIndex(posts) {
  const threads = new Map()
  const postsByCid = new Map(posts.map(post => [post.cid, post]))

  for (const post of posts) {
    const rootCid = threadRootForPost(post)
    if (!rootCid) continue

    const rootPost = postsByCid.get(rootCid) || post
    const thread = threads.get(rootCid) || {
      rootCid,
      posts: [],
      tags: rootPost.tags || post.tags || [],
      lastActivity: post.createdAt
    }

    thread.posts.push(post.cid)
    if (postTimestamp(post) > postTimestamp({ createdAt: thread.lastActivity })) {
      thread.lastActivity = post.createdAt
    }
    if (!thread.tags.length && post.tags?.length) {
      thread.tags = post.tags
    }
    threads.set(rootCid, thread)
  }

  return { threads, postsByCid }
}

export function getTags(posts) {
  const { threads } = buildThreadIndex(posts)
  const counts = {}
  for (const thread of threads.values()) {
    for (const tag of thread.tags) {
      counts[tag] = (counts[tag] || 0) + thread.posts.length
    }
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function getThreadsByTag(posts, tag) {
  const target = (tag || '').trim().toLowerCase()
  const { threads, postsByCid } = buildThreadIndex(posts)
  const results = []

  for (const thread of threads.values()) {
    if (!thread.tags.includes(target)) continue
    const rootPost = postsByCid.get(thread.rootCid)
    results.push({
      rootCid: thread.rootCid,
      title: rootPost?.title || '(untitled)',
      tags: thread.tags,
      lastActivity: thread.lastActivity,
      postCount: thread.posts.length,
      attachment: rootPost?.attachment || null,
      rootAttachment: rootPost?.attachment || null
    })
  }

  return results.sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  )
}

export function getThreadTree(posts, rootCid) {
  const threadPosts = posts
    .filter(post => post.cid === rootCid || post.threadRootCid === rootCid)
    .sort(comparePostsByCreatedAt)
  const postsByCid = new Map(threadPosts.map(post => [post.cid, post]))
  const childrenByParent = new Map()

  const addChild = (parentCid, post) => {
    const children = childrenByParent.get(parentCid) || []
    children.push(post)
    childrenByParent.set(parentCid, children)
  }

  for (const post of threadPosts) {
    if (post.cid === rootCid) continue
    const parentCid = post.parentCid && postsByCid.has(post.parentCid)
      ? post.parentCid
      : null
    addChild(parentCid, post)
  }

  for (const children of childrenByParent.values()) {
    children.sort(comparePostsByCreatedAt)
  }

  const ordered = []
  const visited = new Set()
  const visit = (post, depth) => {
    if (!post || visited.has(post.cid)) return
    visited.add(post.cid)
    const children = childrenByParent.get(post.cid) || []
    ordered.push({
      ...post,
      depth,
      replyCount: children.length
    })
    for (const child of children) {
      visit(child, depth + 1)
    }
  }

  visit(postsByCid.get(rootCid), 0)
  for (const orphan of childrenByParent.get(null) || []) {
    visit(orphan, 0)
  }

  return {
    rootCid,
    posts: ordered
  }
}
