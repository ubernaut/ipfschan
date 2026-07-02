import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { createIpfs } from '../ipfs.js'
import { PostRepository } from '../repository.js'

let helia
let dag
let files
let blockstore
let repo
let dataDir

async function createRepository(indexName = 'index.json') {
  const repository = new PostRepository({
    indexPath: path.join(dataDir, indexName),
    dag,
    files,
    blockstore,
    dataDir
  })
  await repository.init()
  return repository
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ipfschan-'))
  const ipfs = await createIpfs({
    dataDir,
    offline: true
  })
  helia = ipfs.helia
  dag = ipfs.dag
  files = ipfs.files
  blockstore = ipfs.blockstore
  repo = await createRepository()
})

afterEach(async () => {
  if (helia?.stop) {
    await helia.stop()
  }
  rmSync(dataDir, { recursive: true, force: true })
})

describe('PostRepository', () => {
  it('creates threads and counts tags by activity', async () => {
    await repo.createThread({
      title: 'Hello IPFS',
      body: 'First post',
      tags: ['ipfs', 'test']
    })
    await repo.createThread({
      title: 'Second thread',
      body: 'Another post',
      tags: ['ipfs']
    })
    const tags = repo.getTags()
    expect(tags[0].tag).toBe('ipfs')
    expect(tags[0].count).toBe(2)
  })

  it('threads keep replies in tree order with depth metadata', async () => {
    const root = await repo.createThread({
      title: 'Root',
      body: 'Root body',
      tags: ['coding']
    })
    const firstReply = await repo.replyToPost(root.cid, {
      title: 'First reply',
      body: 'Reply body'
    })
    const secondReply = await repo.replyToPost(root.cid, {
      title: 'Second reply',
      body: 'Another reply'
    })
    const nestedReply = await repo.replyToPost(firstReply.cid, {
      title: 'Nested reply',
      body: 'Nested body'
    })

    repo.index.posts[root.cid].createdAt = '2026-01-01T00:00:00.000Z'
    repo.index.posts[firstReply.cid].createdAt = '2026-01-01T00:01:00.000Z'
    repo.index.posts[secondReply.cid].createdAt = '2026-01-01T00:02:00.000Z'
    repo.index.posts[nestedReply.cid].createdAt = '2026-01-01T00:03:00.000Z'

    const thread = repo.getThreadTree(root.cid)
    expect(thread.posts.map(post => post.cid)).toEqual([
      root.cid,
      firstReply.cid,
      nestedReply.cid,
      secondReply.cid
    ])
    expect(thread.posts.map(post => post.depth)).toEqual([0, 1, 2, 1])
    expect(thread.posts[0].replyCount).toBe(2)
    expect(nestedReply.tags).toContain('coding')
  })

  it('imports a known reply CID with its ancestor chain', async () => {
    const root = await repo.createThread({
      title: 'Root for import',
      body: 'Root body',
      tags: ['import']
    })
    const reply = await repo.replyToPost(root.cid, {
      title: 'Reply for import',
      body: 'Reply body'
    })
    const nestedReply = await repo.replyToPost(reply.cid, {
      title: 'Nested for import',
      body: 'Nested body'
    })
    const importedRepo = await createRepository('import-index.json')

    const imported = await importedRepo.importPost(nestedReply.cid)
    const thread = importedRepo.getThreadTree(root.cid)

    expect(imported.cid).toBe(nestedReply.cid)
    expect(Object.keys(importedRepo.index.posts).sort()).toEqual([
      root.cid,
      reply.cid,
      nestedReply.cid
    ].sort())
    expect(thread.posts.map(post => post.cid)).toEqual([
      root.cid,
      reply.cid,
      nestedReply.cid
    ])
    expect(thread.posts.map(post => post.depth)).toEqual([0, 1, 2])
  })

  it('exposes root attachments on tag thread summaries', async () => {
    const root = await repo.createThread({
      title: 'Attachment root',
      body: 'Root with a file',
      tags: ['media'],
      attachment: {
        buffer: new Uint8Array([1, 2, 3, 4]),
        originalname: 'sample.bin',
        mimetype: 'application/octet-stream',
        size: 4
      }
    })

    const threads = repo.getThreadsByTag('media')
    expect(threads[0].attachment).toEqual(root.attachment)
    expect(threads[0].rootAttachment).toEqual(root.attachment)
  })
})
