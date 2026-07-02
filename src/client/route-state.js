export function parseCidList(value) {
  const raw = Array.isArray(value)
    ? value.filter(Boolean).join(',')
    : value || ''

  return [...new Set(
    raw
      .toString()
      .split(',')
      .map(cid => cid.trim())
      .filter(Boolean)
  )]
}

export function mergeCidLists(...lists) {
  const cids = new Set()
  for (const list of lists) {
    for (const cid of parseCidList(list)) {
      cids.add(cid)
    }
  }
  return [...cids]
}

export function serializeCidList(cids) {
  return mergeCidLists(cids).join(',')
}

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function base64UrlDecode(value) {
  const normalized = value.toString().replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

function stringOrNull(value) {
  return typeof value === 'string' && value ? value : null
}

function sanitizeRouteAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return null
  const cid = stringOrNull(attachment.cid)
  if (!cid) return null

  const normalized = { cid }
  const name = stringOrNull(attachment.name)
  const mime = stringOrNull(attachment.mime)
  const size = Number(attachment.size)
  const blocks = Array.isArray(attachment.blocks)
    ? [...new Set(attachment.blocks.filter(block => typeof block === 'string' && block))]
    : []

  if (name) normalized.name = name
  if (mime) normalized.mime = mime
  if (Number.isFinite(size) && size >= 0) normalized.size = size
  if (blocks.length) normalized.blocks = blocks
  return normalized
}

export function sanitizeRouteRecord(record) {
  if (!record || typeof record !== 'object' || !record.cid) return null

  const normalized = {
    cid: record.cid.toString(),
    parentCid: record.parentCid ? record.parentCid.toString() : null,
    threadRootCid: record.threadRootCid ? record.threadRootCid.toString() : null,
    title: (record.title || '').toString().slice(0, 200),
    body: (record.body || '').toString().slice(0, 5000),
    tags: Array.isArray(record.tags)
      ? [...new Set(record.tags.map(tag => tag.toString().trim().toLowerCase()).filter(Boolean))].slice(0, 8)
      : [],
    createdAt: (record.createdAt || '').toString()
  }

  const attachment = sanitizeRouteAttachment(record.attachment)
  if (attachment) normalized.attachment = attachment
  return normalized
}

export function parseRecordList(value) {
  if (!value) return []
  const raw = Array.isArray(value) ? value.find(Boolean) : value
  if (!raw) return []

  try {
    const parsed = JSON.parse(base64UrlDecode(raw))
    if (!Array.isArray(parsed)) return []
    const seen = new Set()
    const records = []
    for (const record of parsed) {
      const normalized = sanitizeRouteRecord(record)
      if (!normalized || seen.has(normalized.cid)) continue
      seen.add(normalized.cid)
      records.push(normalized)
    }
    return records
  } catch (err) {
    return []
  }
}

export function serializeRecordList(records) {
  if (!Array.isArray(records) || !records.length) return ''
  const seen = new Set()
  const normalized = []
  for (const record of records) {
    const sanitized = sanitizeRouteRecord(record)
    if (!sanitized || seen.has(sanitized.cid)) continue
    seen.add(sanitized.cid)
    normalized.push(sanitized)
  }
  return normalized.length ? base64UrlEncode(JSON.stringify(normalized)) : ''
}
