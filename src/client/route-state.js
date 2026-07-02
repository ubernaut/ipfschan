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
