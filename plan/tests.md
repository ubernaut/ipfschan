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
  - Browser thread-index tag normalization.
  - P2P thread-index tag counts.
  - P2P thread summaries sorted by last activity.
  - Parent-before-child thread trees with depth and reply counts.
  - Board manifest type validation and post CID de-duplication.
- `src/client/__tests__/peer-blockstore.test.js`
  - Byte collection from Uint8Array and async iterable blockstore reads.
  - Peer-backed blockstore prefers local blocks.
  - Peer-backed blockstore fetches missing blocks from an open peer and caches them locally.
  - Peer-backed blockstore handles async-iterator read failures by fetching from a peer.
  - Attachment DAG CID collection follows DAG-PB links and de-duplicates repeated block CIDs.
- `src/client/__tests__/route-state.test.js`
  - Thread URL reply-hint parsing, merging, de-duplication, and serialization.
  - Thread URL record bundle serialization, invalid payload handling, UI-derived field stripping, and attachment metadata round trips.
- `src/client/__tests__/decentralized-board.test.js`
  - CID-verified peer thread record import.
  - Live-peer provider CID collection for both index CIDs and thread-root CIDs.
  - Peer batch rollback when a claimed post CID or thread root fails validation.
- `scripts/smoke.js`
  - Starts the real app on an ephemeral local port.
  - Checks the built app shell, health route, create thread, reply, tags, thread tree, attachment streaming, reset, and shutdown.

## Required Local Commands

- `npm test`
  - Runs all Vitest tests.
  - Last run on 2026-07-01 during the public IPFS Pages slice: 5 files passed, 20 tests passed.
- `npm run build`
  - Required after client or Vite changes.
  - Last run on 2026-07-01 during the public IPFS Pages slice: passed; Vite still warns about the large Helia/libp2p chunk.
- `npm run build:pages`
  - Builds the GitHub Pages static bundle into `docs/` with `/ipfschan/` asset paths and `.nojekyll`.
  - Required after client changes when publishing Pages from the `docs/` folder.
  - Last run on 2026-07-01 during the public IPFS Pages slice: passed; Vite still warns about the large Helia/libp2p chunk.
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
- For GitHub Pages changes, run `npm run build:pages` and serve the repo behind an `/ipfschan/` path to confirm assets and serverless P2P startup work.
- For layout/style changes, capture desktop and mobile headless Chrome screenshots against the live or local built app and inspect them for wrapping, overlap, scrollability, and visual hierarchy.
- For URL-routing changes, use a browser/headless browser against a live URL with `?tag=<tag>&thread=<rootCid>` and confirm the active tag, thread card, copy-link button, and posts render.
- For P2P thread-index changes, use a browser/headless browser over HTTPS, create a P2P thread, reply to it, and confirm:
  - the browser reports a thread index CID after the first real thread,
  - new URLs include `index`, `tag`, and `thread` while old `board` links still load,
  - replying adds the new reply CID to `replies=<replyCid,...>`,
  - replying changes the index CID while preserving the thread root,
  - the thread link matches the current URL state,
  - opening an older index URL plus the current `replies=` hint renders the hinted reply after the post block becomes reachable,
  - copied thread URLs include `records=` and a fresh profile can render those records after CID verification even if the public index CID is not reachable yet.
- For load/post UX changes, confirm the modal appears during initial tag/thread loading and during posting, shows `i/j completed queries` or availability advertisement progress, and disappears only after the relevant operation completes or reports a warning.
- For P2P sharing changes on the Node-hosted app, use two separate browser profiles. Profile A should create a P2P thread and show the thread index was updated and mirrored; profile B should open the copied URL with clean IndexedDB/localStorage and show `threads and tags ready from availability mirror` plus the thread content.
- For GitHub Pages/serverless sharing changes, use two separate browser profiles against the Pages URL. Profile A should create a P2P thread and complete or warn on the public IPFS availability advertisement. Profile B should open the copied URL with clean IndexedDB/localStorage and either show `threads and tags ready from public IPFS` or `threads and tags ready from verified URL records` plus the thread content. After profile B posts a reply, profile A should be able to open profile B's updated URL and see the reply from the embedded verified records. Do not expect old already-open Pages tabs to discover later replies without an updated URL or a separate relay/signaling layer.
- For P2P attachment sharing changes, create a P2P thread with an attachment, load the copied index URL in a fresh profile, and verify image attachments render from browser/public IPFS when possible or `/api/p2p/file/<cid>` streams the mirrored bytes in Node-hosted mode.
- For live peer changes, keep profile A open after creating the P2P thread. Profile B should load the copied URL with clean storage and show `threads and tags ready from live peer`.
- For live peer reply changes on the Node-hosted app, keep profile A and profile B open on the same thread. Profile A should post a reply; profile B should either discover the reply through the updated shared `replies=` URL or pull the new thread post records from a live peer advertising the thread root.
- For live peer attachment changes, keep profile A open after creating an attachment thread. Profile B should load the index from the live peer and the attachment link should become a `blob:` URL rather than `/api/p2p/file/...`; if it falls back to `/api/p2p/file/...`, the server mirror is still doing the attachment work.
- For server changes that affect runtime lifecycle, start the server on a non-conflicting port, exercise one request path, then shut it down.
- For deploy changes, validate the Docker image with `/api/health` and stop the disposable container afterward.
- Do not leave dev servers or test terminals running.

## Coverage Gaps

- Client-level tests for rendering nested thread payloads.
- Automated client URL-routing tests.
- Automated browser Helia tests for IndexedDB persistence, live-peer transfer, fresh-profile mirror fallback, P2P route reloads, reply-hint URL reloads, `records=` URL hydration, live-peer reply sync, and image attachment blob URL assertions.
- Stress coverage for very large multi-block attachment transfer over the live peer channel.
- Public deployment controls: auth, moderation, rate limiting, and backups.
