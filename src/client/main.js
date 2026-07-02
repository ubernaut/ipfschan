import { decentralizedBoard } from './decentralized-board.js'

const MODE_P2P = 'p2p'

const state = {
  mode: MODE_P2P,
  boardCid: null,
  tags: [],
  threads: [],
  currentTag: null,
  currentThread: null,
  posts: []
}

const objectUrls = new Set()

const appEl = document.getElementById('app')
const tagsEl = document.getElementById('tags')
const threadsEl = document.getElementById('threads')
const postsEl = document.getElementById('thread-posts')
const replyWrap = document.getElementById('reply-form-wrap')
const replyForm = document.getElementById('reply-form')
const threadForm = document.getElementById('thread-form')
const statusEl = document.getElementById('status')
const copyThreadLinkBtn = document.getElementById('copy-thread-link')
const newP2PBoardBtn = document.getElementById('new-p2p-board')
const copyBoardLinkBtn = document.getElementById('copy-board-link')
const loadBoardForm = document.getElementById('load-board-form')
const currentBoardEl = document.getElementById('current-board')
const p2pStatusEl = document.getElementById('p2p-status')
const modeReadoutEl = document.getElementById('mode-readout')
const boardReadoutEl = document.getElementById('board-readout')
const tagReadoutEl = document.getElementById('tag-readout')
const threadReadoutEl = document.getElementById('thread-readout')

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function setStatus(message, tone = 'info') {
  statusEl.textContent = message || ''
  statusEl.dataset.tone = tone
}

function setP2PStatus(message, tone = 'info') {
  p2pStatusEl.textContent = message || ''
  p2pStatusEl.dataset.tone = tone
}

function updateTelemetry() {
  document.body.dataset.mode = state.mode
  if (appEl) appEl.dataset.mode = state.mode
  if (modeReadoutEl) modeReadoutEl.textContent = 'P2P'
  if (boardReadoutEl) {
    boardReadoutEl.textContent = state.boardCid
      ? shortCid(state.boardCid)
      : 'browser local'
  }
  if (tagReadoutEl) tagReadoutEl.textContent = state.currentTag || 'none'
  if (threadReadoutEl) threadReadoutEl.textContent = state.currentThread ? shortCid(state.currentThread) : 'none'
}

function readRoute() {
  const params = new URLSearchParams(window.location.search)
  return {
    board: params.get('board') || null,
    tag: params.get('tag') || null,
    thread: params.get('thread') || null
  }
}

function routeUrl({
  board = state.boardCid,
  tag = state.currentTag,
  thread = state.currentThread
} = {}) {
  const url = new URL(window.location.href)
  url.searchParams.delete('mode')
  if (board) {
    url.searchParams.set('board', board)
  } else {
    url.searchParams.delete('board')
  }

  if (tag) {
    url.searchParams.set('tag', tag)
  } else {
    url.searchParams.delete('tag')
  }

  if (thread) {
    url.searchParams.set('thread', thread)
  } else {
    url.searchParams.delete('thread')
  }

  return url
}

function threadUrl(rootCid = state.currentThread, tag = state.currentTag) {
  return routeUrl({ thread: rootCid, tag })
}

function boardUrl(boardCid = state.boardCid) {
  return routeUrl({ board: boardCid, tag: null, thread: null })
}

function updateRoute(
  {
    board = state.boardCid,
    tag = state.currentTag,
    thread = state.currentThread
  } = {},
  { replace = false } = {}
) {
  const url = routeUrl({ board, tag, thread })
  if (url.href === window.location.href) return
  const statePayload = { mode: MODE_P2P, board, tag, thread }
  if (replace) {
    window.history.replaceState(statePayload, '', url)
  } else {
    window.history.pushState(statePayload, '', url)
  }
}

function renderModeControls() {
  copyBoardLinkBtn.disabled = !state.boardCid
  currentBoardEl.textContent = state.boardCid
    ? `Current board: ${state.boardCid}`
    : 'Current board: browser local'
  updateTelemetry()
}

function boardReadyMessage() {
  const source = {
    mirror: ' from availability mirror',
    peer: ' from live peer',
    public: ' from public IPFS',
    local: ''
  }[decentralizedBoard.lastLoadSource] || ''
  return `board ready${source}: ${shortCid(state.boardCid)}`
}

function boardPublishedMessage() {
  if (decentralizedBoard.serverless) {
    if (decentralizedBoard.lastPublicProvide?.pending) {
      return `board published locally; public IPFS announce pending for ${decentralizedBoard.lastPublicProvide.attempted} CIDs: ${shortCid(state.boardCid)}`
    }
    if (decentralizedBoard.lastPublicProvideError) {
      return `board published locally; public IPFS announce incomplete: ${decentralizedBoard.lastPublicProvideError.message}`
    }
    if (decentralizedBoard.lastPublicProvide) {
      const { attempted, provided } = decentralizedBoard.lastPublicProvide
      return `board published; public IPFS announce attempted for ${provided}/${attempted} CIDs: ${shortCid(state.boardCid)}`
    }
    return `board published locally; public IPFS ${decentralizedBoard.publicNetworkSummary() || 'starting'}: ${shortCid(state.boardCid)}`
  }
  if (decentralizedBoard.lastMirrorError) {
    return `board published locally; mirror failed: ${decentralizedBoard.lastMirrorError.message}`
  }
  return `board published and mirrored: ${shortCid(state.boardCid)}`
}

function publishStatusTone() {
  if (decentralizedBoard.lastMirrorError || decentralizedBoard.lastPublicProvideError) {
    return 'error'
  }
  return 'info'
}

async function loadP2PBoard(boardCid) {
  state.mode = MODE_P2P
  renderModeControls()
  setP2PStatus('starting browser node...')
  await decentralizedBoard.init()

  const targetCid = boardCid || decentralizedBoard.latestLocalBoardCid()
  if (targetCid) {
    setP2PStatus('loading board...')
    await decentralizedBoard.load(targetCid)
  } else {
    setP2PStatus('creating board...')
    await decentralizedBoard.newBoard()
  }

  state.boardCid = decentralizedBoard.boardCid
  setP2PStatus(boardReadyMessage(), decentralizedBoard.lastLoadSource === 'mirror' ? 'info' : 'info')
  renderModeControls()
}

async function switchToP2PMode({ boardCid = null, replace = false } = {}) {
  state.currentTag = null
  state.currentThread = null
  state.threads = []
  state.posts = []
  clearThreadView('')
  await loadP2PBoard(boardCid)
  await loadTags()
  renderThreads()
  updateRoute({ board: state.boardCid, tag: null, thread: null }, { replace })
}

async function loadTags() {
  state.tags = decentralizedBoard.getTags()
  renderTags()
  renderModeControls()
}

function clearThreadView(message = '') {
  state.currentThread = null
  state.posts = []
  revokeObjectUrls()
  postsEl.textContent = message
  replyWrap.classList.add('hidden')
  copyThreadLinkBtn.classList.add('hidden')
  updateTelemetry()
}

async function loadThreadsForTag(tag) {
  state.currentTag = tag
  state.threads = decentralizedBoard.getThreadsByTag(tag)
  renderTags()
  renderThreads()
  updateTelemetry()
}

async function selectTag(tag, { updateUrl: shouldUpdateUrl = true } = {}) {
  await loadThreadsForTag(tag)
  clearThreadView('')
  if (shouldUpdateUrl) {
    updateRoute({ tag, thread: null })
  }
}

async function fetchThread(rootCid) {
  const data = decentralizedBoard.getThreadTree(rootCid)
  if (!data.posts.length) {
    throw new Error('Thread not found in current board')
  }
  return data
}

async function openThread(rootCid, { updateUrl: shouldUpdateUrl = true, tag = state.currentTag } = {}) {
  const data = await fetchThread(rootCid)
  state.currentThread = rootCid
  state.posts = data.posts || []
  copyThreadLinkBtn.classList.remove('hidden')
  renderPosts()
  updateTelemetry()
  if (shouldUpdateUrl) {
    updateRoute({ tag, thread: rootCid })
  }
}

async function applyRoute({ replace = false } = {}) {
  const route = readRoute()
  state.mode = MODE_P2P
  state.boardCid = route.board
  renderModeControls()

  try {
    await loadP2PBoard(route.board)
  } catch (err) {
    state.tags = []
    state.threads = []
    clearThreadView('')
    renderTags()
    renderThreads()
    setP2PStatus(err.message, 'error')
    throw err
  }

  await loadTags()

  if (route.tag) {
    await loadThreadsForTag(route.tag)
  } else {
    state.currentTag = null
    state.threads = []
    renderTags()
    renderThreads()
  }

  if (route.thread) {
    try {
      await openThread(route.thread, { updateUrl: false, tag: route.tag })
      if (replace) {
        updateRoute(
          { board: state.boardCid, tag: route.tag, thread: route.thread },
          { replace: true }
        )
      }
    } catch (err) {
      clearThreadView('')
      setStatus(err.message, 'error')
    }
  } else {
    clearThreadView('')
    if (replace) {
      updateRoute(
        { board: state.boardCid, tag: route.tag, thread: null },
        { replace: true }
      )
    }
  }
}

function renderTags() {
  tagsEl.innerHTML = ''
  if (!state.tags.length) {
    tagsEl.textContent = 'No tags yet.'
    updateTelemetry()
    return
  }
  state.tags.forEach(({ tag, count }) => {
    const btn = el('button', 'tag-btn')
    if (tag === state.currentTag) {
      btn.classList.add('active')
    }
    btn.textContent = `${tag} (${count})`
    btn.addEventListener('click', () => selectTag(tag))
    tagsEl.appendChild(btn)
  })
  updateTelemetry()
}

function renderThreads() {
  threadsEl.innerHTML = ''
  if (!state.threads.length) {
    threadsEl.textContent = state.currentTag ? 'No threads for this tag.' : 'Pick a tag to view threads.'
    updateTelemetry()
    return
  }
  state.threads.forEach(thread => {
    const card = el('div', 'thread-card')
    const title = el('h3', null, thread.title)
    const meta = el(
      'p',
      'meta',
      `Posts: ${thread.postCount} - Last: ${new Date(thread.lastActivity).toLocaleString()}`
    )
    if (thread.attachment && isImageAttachment(thread.attachment)) {
      const media = el('div', 'attachment-media')
      attachImage(media, thread.attachment)
      card.append(media)
    }
    const openBtn = el('button', 'primary', 'Open')
    openBtn.addEventListener('click', () => openThread(thread.rootCid))
    const link = el('a', 'thread-link', 'Link')
    link.href = threadUrl(thread.rootCid, state.currentTag).toString()
    link.addEventListener('click', e => {
      e.preventDefault()
      openThread(thread.rootCid)
    })
    card.append(title, meta, openBtn, link)
    threadsEl.appendChild(card)
  })
  updateTelemetry()
}

function isImageAttachment(att) {
  return att && typeof att.mime === 'string' && att.mime.startsWith('image/')
}

function postDepth(post) {
  const depth = Number(post.depth)
  return Number.isFinite(depth) && depth > 0 ? depth : 0
}

function shortCid(cid) {
  if (!cid || cid.length <= 18) return cid || ''
  return `${cid.slice(0, 10)}...${cid.slice(-6)}`
}

function revokeObjectUrls() {
  for (const url of objectUrls) {
    URL.revokeObjectURL(url)
  }
  objectUrls.clear()
}

async function attachmentUrl(attachment) {
  if (!attachment?.cid) return null
  const url = await decentralizedBoard.attachmentUrl(attachment)
  if (url?.startsWith('blob:')) {
    objectUrls.add(url)
  }
  return url
}

function attachImage(container, attachment) {
  const img = el('img', 'thumb')
  img.alt = attachment.name || 'attachment'
  img.onclick = e => {
    e.stopPropagation()
    img.classList.toggle('expanded')
  }
  container.append(img)
  attachmentUrl(attachment)
    .then(url => {
      if (url) img.src = url
    })
    .catch(err => {
      img.remove()
      container.append(el('p', 'meta', `attachment unavailable: ${err.message}`))
    })
}

function attachDownload(container, attachment) {
  const link = el('a', 'attachment', `Attachment: ${attachment.name || shortCid(attachment.cid)}`)
  link.target = '_blank'
  link.rel = 'noreferrer'
  container.append(link)
  attachmentUrl(attachment)
    .then(url => {
      if (url) link.href = url
    })
    .catch(err => {
      link.removeAttribute('href')
      link.textContent = `Attachment unavailable: ${err.message}`
    })
}

function renderPosts() {
  revokeObjectUrls()
  postsEl.innerHTML = ''
  if (!state.posts.length) {
    postsEl.textContent = 'No posts in this thread yet.'
    updateTelemetry()
    return
  }
  state.posts.forEach(post => {
    const card = el('div', 'post-card')
    const depth = postDepth(post)
    card.dataset.depth = String(depth)
    card.style.setProperty('--reply-depth', String(Math.min(depth, 8)))

    const title = el('h4', null, post.title || '(no title)')
    const meta = el(
      'p',
      'meta',
      `${new Date(post.createdAt).toLocaleString()} - cid: ${post.cid}`
    )
    const body = el('p', 'body', post.body)
    card.append(title, meta)

    if (post.parentCid) {
      card.append(el('p', 'meta reply-parent', `reply to: ${shortCid(post.parentCid)}`))
    }

    card.append(body)

    if (post.attachment) {
      if (isImageAttachment(post.attachment)) {
        const media = el('div', 'attachment-media')
        attachImage(media, post.attachment)
        card.append(media)
      }
      attachDownload(card, post.attachment)
    }

    const replyBtn = el('button', 'secondary', 'Reply')
    replyBtn.addEventListener('click', () => {
      replyForm.parentCid.value = post.cid
      replyWrap.classList.remove('hidden')
    })
    card.append(replyBtn)

    postsEl.appendChild(card)
  })
  updateTelemetry()
}

function fileFromForm(formData, name) {
  const file = formData.get(name)
  return file && file.size ? file : null
}

function tagsFromForm(formData) {
  return formData
    .get('tags')
    ?.toString()
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean) || []
}

async function createThread(formData) {
  const post = await decentralizedBoard.createThread({
    title: formData.get('title')?.toString() || '',
    body: formData.get('body')?.toString() || '',
    tags: tagsFromForm(formData),
    attachment: fileFromForm(formData, 'attachment')
  })
  state.boardCid = decentralizedBoard.boardCid
  await loadTags()
  const tag = state.currentTag && post.tags.includes(state.currentTag)
    ? state.currentTag
    : post.tags[0]
  await loadThreadsForTag(tag)
  await openThread(post.threadRootCid || post.cid, { tag })
  setP2PStatus(boardPublishedMessage(), publishStatusTone())
  renderModeControls()
  return post
}

threadForm.addEventListener('submit', async e => {
  e.preventDefault()
  const formData = new FormData(threadForm)
  try {
    const post = await createThread(formData)
    threadForm.reset()
    setStatus(`thread created: ${shortCid(post.cid)}`)
  } catch (err) {
    setStatus(err.message, 'error')
  }
})

async function replyP2P(parentCid, formData) {
  const record = await decentralizedBoard.replyToPost(parentCid, {
    title: formData.get('title')?.toString() || '',
    body: formData.get('body')?.toString() || '',
    attachment: fileFromForm(formData, 'attachment')
  })
  state.boardCid = decentralizedBoard.boardCid
  await loadTags()
  if (state.currentTag) {
    await loadThreadsForTag(state.currentTag)
  }
  state.currentThread = state.currentThread || record.threadRootCid
  if (state.currentThread) {
    await openThread(state.currentThread, { updateUrl: false })
  }
  updateRoute(
    { board: state.boardCid, tag: state.currentTag, thread: state.currentThread },
    { replace: true }
  )
  setP2PStatus(boardPublishedMessage(), publishStatusTone())
}

replyForm.addEventListener('submit', async e => {
  e.preventDefault()
  const parentCid = replyForm.parentCid.value
  if (!parentCid) {
    setStatus('Pick a post to reply to.', 'error')
    return
  }
  const formData = new FormData(replyForm)
  try {
    await replyP2P(parentCid, formData)
    replyForm.reset()
    replyWrap.classList.add('hidden')
    setStatus('reply posted')
  } catch (err) {
    setStatus(err.message, 'error')
  }
})

copyThreadLinkBtn.addEventListener('click', async () => {
  if (!state.currentThread) return
  const url = threadUrl().toString()
  try {
    await navigator.clipboard.writeText(url)
    setStatus('thread link copied')
  } catch (err) {
    setStatus(url)
  }
})

newP2PBoardBtn.addEventListener('click', async () => {
  try {
    state.mode = MODE_P2P
    clearThreadView('')
    await decentralizedBoard.newBoard()
    state.boardCid = decentralizedBoard.boardCid
    state.currentTag = null
    state.threads = []
    await loadTags()
    renderThreads()
    renderModeControls()
    setP2PStatus(boardPublishedMessage(), publishStatusTone())
    updateRoute({ board: state.boardCid, tag: null, thread: null })
  } catch (err) {
    setStatus(err.message, 'error')
    setP2PStatus(err.message, 'error')
  }
})

copyBoardLinkBtn.addEventListener('click', async () => {
  if (!state.boardCid) return
  const url = boardUrl().toString()
  try {
    await navigator.clipboard.writeText(url)
    setStatus('board link copied')
  } catch (err) {
    setStatus(url)
  }
})

loadBoardForm.addEventListener('submit', async e => {
  e.preventDefault()
  const boardCid = new FormData(loadBoardForm).get('boardCid')?.toString().trim()
  if (!boardCid) {
    setP2PStatus('board CID is required', 'error')
    return
  }
  try {
    await switchToP2PMode({ boardCid })
    loadBoardForm.reset()
    setStatus(`board loaded: ${shortCid(state.boardCid)}`)
  } catch (err) {
    setStatus(err.message, 'error')
    setP2PStatus(err.message, 'error')
  }
})

window.addEventListener('popstate', () => {
  applyRoute().catch(err => {
    setStatus(err.message, 'error')
  })
})

window.addEventListener('ipfschan:public-announce', () => {
  if (!decentralizedBoard.serverless || !state.boardCid) return
  setP2PStatus(boardPublishedMessage(), publishStatusTone())
})

applyRoute({ replace: true }).catch(err => {
  tagsEl.textContent = `Failed to load tags: ${err.message}`
  setStatus(err.message, 'error')
})
