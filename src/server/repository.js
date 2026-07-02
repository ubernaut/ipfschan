import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { CID } from 'multiformats/cid'
import {
  normalizeP2PBoard,
  postPayloadFromRecord,
  postRecordFromPayload
} from '../shared/p2p-snapshot.js'

const EMPTY_INDEX = { posts: {}, threads: {} }

function postTimestamp(post) {
  const time = Date.parse(post?.createdAt)
  return Number.isFinite(time) ? time : 0
}

function comparePostsByCreatedAt(a, b) {
  const timeDelta = postTimestamp(a) - postTimestamp(b)
  if (timeDelta !== 0) return timeDelta
  return (a?.cid || '').localeCompare(b?.cid || '')
}

function newerIso(a, b) {
  return postTimestamp({ createdAt: a }) >= postTimestamp({ createdAt: b }) ? a : b
}

export class PostRepository {
  constructor({ indexPath, dag, files, blockstore, dataDir }) {
    this.indexPath = indexPath
    this.dag = dag
    this.files = files
    this.blockstore = blockstore
    this.dataDir = dataDir
    this.index = structuredClone(EMPTY_INDEX)
  }

  async init() {
    await mkdir(path.dirname(this.indexPath), { recursive: true })
    if (existsSync(this.indexPath)) {
      const raw = await readFile(this.indexPath, 'utf8')
      this.index = JSON.parse(raw)
    } else {
      await this._persist()
    }
  }

  normalizeTags(tags) {
    const cleaned = (tags || [])
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
    const unique = [...new Set(cleaned)]
    if (unique.length === 0) {
      throw new Error('At least one tag is required')
    }
    return unique.slice(0, 8)
  }

  sanitizeBody(body) {
    return (body || '').toString().slice(0, 5000)
  }

  async createThread({ title, body, tags, attachment }) {
    const normalizedTags = this.normalizeTags(tags)
    const createdAt = new Date().toISOString()
    const safeBody = this.sanitizeBody(body)
    const attachmentInfo = await this._storeAttachment(attachment)

    const postPayload = {
      parentCid: null,
      threadRootCid: null,
      title: title?.toString().slice(0, 200) || '',
      body: safeBody,
      tags: normalizedTags,
      createdAt,
      ...(attachmentInfo ? { attachment: attachmentInfo } : {})
    }

    const cid = await this.dag.add(postPayload)
    const cidStr = cid.toString()

    const postRecord = { ...postPayload, cid: cidStr, threadRootCid: cidStr }
    this.index.posts[cidStr] = postRecord

    this.index.threads[cidStr] = {
      posts: [cidStr],
      tags: normalizedTags,
      lastActivity: createdAt
    }

    await this._persist()
    return postRecord
  }

  async replyToPost(parentCidStr, { body, title, attachment }) {
    const parent = this.index.posts[parentCidStr]
    if (!parent) {
      throw new Error('Parent post not found')
    }

    const threadRoot = parent.threadRootCid
    const thread = this.index.threads[threadRoot]
    const createdAt = new Date().toISOString()
    const attachmentInfo = await this._storeAttachment(attachment)

    const postPayload = {
      parentCid: parentCidStr,
      threadRootCid: threadRoot,
      title: (title || '').toString().slice(0, 200),
      body: this.sanitizeBody(body),
      tags: thread.tags,
      createdAt,
      ...(attachmentInfo ? { attachment: attachmentInfo } : {})
    }

    const cid = await this.dag.add(postPayload)
    const cidStr = cid.toString()

    const record = { ...postPayload, cid: cidStr }
    this.index.posts[cidStr] = record
    thread.posts.push(cidStr)
    thread.lastActivity = createdAt

    await this._persist()
    return record
  }

  getTags() {
    const counts = {}
    for (const thread of Object.values(this.index.threads)) {
      for (const tag of thread.tags) {
        counts[tag] = (counts[tag] || 0) + thread.posts.length
      }
    }
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  getStats() {
    return {
      postCount: Object.keys(this.index.posts).length,
      threadCount: Object.keys(this.index.threads).length,
      tagCount: this.getTags().length
    }
  }

  getThreadsByTag(tag) {
    const target = tag.trim().toLowerCase()
    const threads = []
    for (const [rootCid, thread] of Object.entries(this.index.threads)) {
      if (!thread.tags.includes(target)) continue
      const rootPost = this.index.posts[rootCid]
      const attachment = rootPost?.attachment || null
      threads.push({
        rootCid,
        title: rootPost?.title || '(untitled)',
        tags: thread.tags,
        lastActivity: thread.lastActivity,
        postCount: thread.posts.length,
        attachment,
        rootAttachment: attachment
      })
    }
    return threads.sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    )
  }

  getThreadTree(rootCid) {
    const thread = this.index.threads[rootCid]
    if (!thread) return null
    const posts = this._threadPostsInTreeOrder(rootCid, thread)

    return { rootCid, posts }
  }

  _threadPostsInTreeOrder(rootCid, thread) {
    const posts = thread.posts
      .map(cid => this.index.posts[cid])
      .filter(Boolean)

    const postsByCid = new Map(posts.map(post => [post.cid, post]))
    const childrenByParent = new Map()

    const addChild = (parentCid, post) => {
      const children = childrenByParent.get(parentCid) || []
      children.push(post)
      childrenByParent.set(parentCid, children)
    }

    for (const post of posts) {
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

    for (const post of [...posts].sort(comparePostsByCreatedAt)) {
      visit(post, 0)
    }

    return ordered
  }

  async importPost(cidStr) {
    return this._importPostWithAncestors(cidStr, new Set())
  }

  async _importPostWithAncestors(cidStr, seen) {
    const cid = CID.parse(cidStr)
    const normalizedCid = cid.toString()
    if (this.index.posts[normalizedCid]) {
      return this.index.posts[normalizedCid]
    }
    if (seen.has(normalizedCid)) {
      throw new Error('Circular post ancestry detected')
    }
    seen.add(normalizedCid)

    const post = await this.dag.get(cid)
    if (!post || typeof post !== 'object') {
      throw new Error('Failed to load post from IPFS')
    }

    const parentCid = post.parentCid ? CID.parse(post.parentCid).toString() : null
    const declaredRootCid = post.threadRootCid ? CID.parse(post.threadRootCid).toString() : null

    if (parentCid && !this.index.posts[parentCid]) {
      await this._importPostWithAncestors(parentCid, seen)
    }

    if (
      declaredRootCid &&
      declaredRootCid !== normalizedCid &&
      declaredRootCid !== parentCid &&
      !this.index.posts[declaredRootCid]
    ) {
      await this._importPostWithAncestors(declaredRootCid, seen)
    }

    const parent = parentCid ? this.index.posts[parentCid] : null
    const rootCid = declaredRootCid || parent?.threadRootCid || parentCid || normalizedCid
    const normalizedTags = this.normalizeTags(post.tags?.length ? post.tags : parent?.tags || [])
    const createdAt = post.createdAt || new Date().toISOString()

    const record = {
      cid: normalizedCid,
      parentCid,
      threadRootCid: rootCid,
      title: (post.title || '').toString().slice(0, 200),
      body: this.sanitizeBody(post.body || ''),
      tags: normalizedTags,
      createdAt,
      ...(post.attachment ? { attachment: post.attachment } : {})
    }

    this.index.posts[normalizedCid] = record
    const thread = this.index.threads[rootCid] || { posts: [], tags: normalizedTags, lastActivity: createdAt }
    if (!thread.posts.includes(normalizedCid)) {
      thread.posts.push(normalizedCid)
    }
    thread.tags = thread.tags?.length ? thread.tags : normalizedTags
    thread.lastActivity = thread.lastActivity
      ? newerIso(thread.lastActivity, createdAt)
      : createdAt
    this.index.threads[rootCid] = thread
    await this._persist()
    return record
  }

  async _storeAttachment(file) {
    if (!file) return null
    const bytes = file.buffer instanceof Uint8Array ? file.buffer : new Uint8Array(file.buffer)
    const cid = await this.files.addBytes(bytes)
    return {
      cid: cid.toString(),
      name: file.originalname,
      mime: file.mimetype,
      size: file.size
    }
  }

  async _persist() {
    const tmp = `${this.indexPath}.tmp`
    const serialized = JSON.stringify(this.index, null, 2)
    await writeFile(tmp, serialized, 'utf8')
    await writeFile(this.indexPath, serialized, 'utf8')
  }

  async reset() {
    this.index = structuredClone(EMPTY_INDEX)
    await this._persist()
  }

  findAttachmentMeta(cidStr) {
    for (const post of Object.values(this.index.posts)) {
      if (post?.attachment?.cid === cidStr) {
        return post.attachment
      }
    }
    return null
  }

  async mirrorP2PBoard({ boardCid, board, posts, attachments = [] }) {
    if (!boardCid) {
      throw new Error('boardCid is required')
    }
    const normalizedBoardCid = CID.parse(boardCid).toString()
    const normalizedBoard = normalizeP2PBoard(board)
    const postsByCid = new Map((posts || []).map(post => [post.cid, post]))

    for (const attachment of attachments) {
      const cid = CID.parse(attachment.cid).toString()
      const storedCid = await this.files.addBytes(attachment.bytes)
      if (storedCid.toString() !== cid) {
        throw new Error(`Attachment CID mismatch for ${cid}`)
      }
    }

    for (const postCid of normalizedBoard.posts) {
      const post = postsByCid.get(postCid)
      if (!post) {
        throw new Error(`Missing post record for ${postCid}`)
      }

      const payload = postPayloadFromRecord(post)
      const storedCid = await this.dag.add(payload)
      if (storedCid.toString() !== postCid) {
        throw new Error(`Post CID mismatch for ${postCid}`)
      }
    }

    const storedBoardCid = await this.dag.add(normalizedBoard)
    if (storedBoardCid.toString() !== normalizedBoardCid) {
      throw new Error(`Board CID mismatch for ${normalizedBoardCid}`)
    }

    return {
      boardCid: normalizedBoardCid,
      postCount: normalizedBoard.posts.length,
      attachmentCount: attachments.length
    }
  }

  async getP2PBoardSnapshot(boardCid) {
    const cid = CID.parse(boardCid)
    const board = normalizeP2PBoard(await this.dag.get(cid))
    const posts = []

    for (const postCid of board.posts) {
      const normalizedPostCid = CID.parse(postCid).toString()
      const payload = await this.dag.get(CID.parse(normalizedPostCid))
      posts.push(postRecordFromPayload(normalizedPostCid, payload))
    }

    return {
      boardCid: cid.toString(),
      board,
      posts
    }
  }
}
