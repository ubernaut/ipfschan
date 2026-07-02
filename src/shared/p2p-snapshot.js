export const BOARD_TYPE = 'ipfschan-board/v1'

export function normalizeP2PBoard(board) {
  if (!board || typeof board !== 'object' || board.type !== BOARD_TYPE) {
    throw new Error('Unsupported board CID')
  }

  return {
    ...board,
    posts: [...new Set(board.posts || [])]
  }
}

export function postPayloadFromRecord(post) {
  if (!post || typeof post !== 'object' || !post.cid) {
    throw new Error('Post record is missing a CID')
  }

  const { cid, depth, replyCount, ...payload } = post
  if (!payload.parentCid && payload.threadRootCid === cid) {
    payload.threadRootCid = null
  }
  return payload
}

export function postRecordFromPayload(cid, payload) {
  const record = {
    ...payload,
    cid
  }

  if (!record.parentCid && !record.threadRootCid) {
    record.threadRootCid = cid
  }

  return record
}
