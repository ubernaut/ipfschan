# Testing Strategy

Use headless validation first. Keep tests executable through `npm test` and avoid requiring public IPFS networking for normal development.

## Current Coverage

- `src/server/__tests__/ipfs.test.js`
  - DAG-JSON add/get round trip through the filesystem blockstore.
  - UnixFS addBytes/cat round trip through the filesystem blockstore.
- `src/server/__tests__/repository.test.js`
  - Tag popularity counts.
  - Tree-ordered replies with depth and reply counts.
  - Recursive import of a known reply CID and its ancestor chain.
  - Root attachment exposure on tagged thread summaries.
- `src/server/__tests__/api.test.js`
  - Health route and index counts.
  - Thread creation with attachment upload.
  - Reply creation and tree-depth API output.
  - Tag listing and tagged thread summaries.
  - File streaming.
  - Reset and import after index reset.
  - P2P board mirror upload, board snapshot retrieval, and mirrored file streaming.
  - P2P signaling provider registration, provider lookup, and message forwarding.
- `src/client/__tests__/board-model.test.js`
  - Browser board tag normalization.
  - P2P board tag counts.
  - P2P thread summaries sorted by last activity.
  - Parent-before-child thread trees with depth and reply counts.
  - Board manifest type validation and post CID de-duplication.
- `src/client/__tests__/peer-blockstore.test.js`
  - Byte collection from Uint8Array and async iterable blockstore reads.
  - Peer-backed blockstore prefers local blocks.
  - Peer-backed blockstore fetches missing blocks from an open peer and caches them locally.
  - Peer-backed blockstore handles async-iterator read failures by fetching from a peer.
- `scripts/smoke.js`
  - Starts the real app on an ephemeral local port.
  - Checks the built app shell, health route, create thread, reply, tags, thread tree, attachment streaming, reset, and shutdown.

## Required Local Commands

- `npm test`
  - Runs all Vitest tests.
  - Last run on 2026-07-01: 5 files passed, 20 tests passed.
- `npm run build`
  - Required after client or Vite changes.
  - Last run on 2026-07-01 after the P2P attachment work: passed; Vite still warns about the large Helia/libp2p chunk.
- `npm run smoke`
  - Starts and stops a real local app instance with temp storage.
- `npm run verify`
  - Runs `npm test`, `npm run build`, and `npm run smoke`.
  - Last run on 2026-06-30: passed.
- `docker build -t ipfschan:local .`
  - Builds the deployable Node 24 runtime image.
  - Last run on 2026-06-28: passed.

## Manual/Smoke Checks

- For UI-affecting changes, run `npm run build` at minimum.
- For layout/style changes, capture desktop and mobile headless Chrome screenshots against the live or local built app and inspect them for wrapping, overlap, scrollability, and visual hierarchy.
- For URL-routing changes, use a browser/headless browser against a live URL with `?tag=<tag>&thread=<rootCid>` and confirm the active tag, thread card, copy-link button, and posts render.
- For P2P board-mode changes, use a browser/headless browser against `?mode=p2p` over HTTPS, create a P2P thread, reply to it, and confirm:
  - the browser reports a board CID,
  - the URL includes `mode=p2p`, `board`, `tag`, and `thread`,
  - replying changes the board CID while preserving the thread root,
  - the thread link matches the current URL state.
- For P2P sharing changes, use two separate browser profiles. Profile A should create a P2P thread and show `board published and mirrored`; profile B should open the copied URL with clean IndexedDB/localStorage and show `board ready from availability mirror` plus the thread content.
- For P2P attachment sharing changes, create a P2P thread with an attachment, load the copied board URL in a fresh profile, and verify `/api/p2p/file/<cid>` streams the mirrored bytes.
- For live peer changes, keep profile A open after creating the P2P thread. Profile B should load the copied URL with clean storage and show `board ready from live peer`.
- For live peer attachment changes, keep profile A open after creating an attachment thread. Profile B should load the board from the live peer and the attachment link should become a `blob:` URL rather than `/api/p2p/file/...`; if it falls back to `/api/p2p/file/...`, the server mirror is still doing the attachment work.
- For server changes that affect runtime lifecycle, start the server on a non-conflicting port, exercise one request path, then shut it down.
- For deploy changes, validate the Docker image with `/api/health` and stop the disposable container afterward.
- Do not leave dev servers or test terminals running.

## Coverage Gaps

- Client-level tests for rendering nested thread payloads.
- Automated client URL-routing tests.
- Automated browser Helia tests for IndexedDB persistence, live-peer transfer, fresh-profile mirror fallback, P2P route reloads, and image attachment blob URL assertions.
- Stress coverage for very large multi-block attachment transfer over the live peer channel.
- Public deployment controls: auth, moderation, rate limiting, and backups.
