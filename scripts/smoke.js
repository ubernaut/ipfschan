import { mkdtemp, rm } from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'
import { createApp } from '../src/server/app.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function readJson(res) {
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`)
  }
  return payload
}

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve(server)
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ipfschan-smoke-'))
  let server
  let helia

  try {
    const created = await createApp({
      dataDir,
      serveStatic: true,
      offline: true
    })
    helia = created.helia
    server = await listen(created.app)
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`

    const home = await fetch(`${baseUrl}/`)
    assert(home.ok, 'root page did not load')
    assert((await home.text()).includes('ipfschan'), 'root page did not include app shell')

    const health = await readJson(await fetch(`${baseUrl}/api/health`))
    assert(health.ok === true, 'health route was not ready')

    const threadForm = new FormData()
    threadForm.set('title', 'Smoke thread')
    threadForm.set('body', 'Smoke root body')
    threadForm.set('tags', 'deploy, smoke')
    threadForm.set('attachment', new Blob(['smoke attachment'], { type: 'text/plain' }), 'smoke.txt')

    const thread = await readJson(await fetch(`${baseUrl}/api/thread`, {
      method: 'POST',
      body: threadForm
    }))
    assert(thread.cid, 'thread CID missing')
    assert(thread.attachment?.cid, 'attachment CID missing')

    const replyForm = new FormData()
    replyForm.set('body', 'Smoke reply')
    const reply = await readJson(await fetch(`${baseUrl}/api/thread/${encodeURIComponent(thread.cid)}/reply`, {
      method: 'POST',
      body: replyForm
    }))
    assert(reply.parentCid === thread.cid, 'reply parent did not match')

    const tags = await readJson(await fetch(`${baseUrl}/api/tags`))
    assert(tags.some(tag => tag.tag === 'deploy' && tag.count === 2), 'deploy tag count missing')

    const tree = await readJson(await fetch(`${baseUrl}/api/thread/${encodeURIComponent(thread.cid)}`))
    assert(tree.posts.length === 2, 'thread tree did not include root and reply')
    assert(tree.posts[1].depth === 1, 'reply depth was not returned')

    const file = await fetch(`${baseUrl}/api/file/${encodeURIComponent(thread.attachment.cid)}`)
    assert(file.ok, 'attachment did not stream')
    assert(await file.text() === 'smoke attachment', 'attachment contents did not match')

    await readJson(await fetch(`${baseUrl}/api/reset`, { method: 'POST' }))
    const resetHealth = await readJson(await fetch(`${baseUrl}/api/health`))
    assert(resetHealth.postCount === 0, 'reset did not clear posts')

    console.log(`Smoke passed at ${baseUrl}`)
  } finally {
    if (server) {
      await close(server)
    }
    if (helia?.stop) {
      await helia.stop()
    }
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
