# Project Plan

Goal: build ipfschan as a Vite/vanilla-JS imageboard where users host posts and media on IPFS, while the app keeps a local index for tag, thread, and reply discovery.

## Current Direction

- Keep the implementation in ES modules with Express for the API, Helia for IPFS, and Vite for the client.
- Keep the server offline by default so local development and tests do not depend on network interfaces.
- Treat IPFS CIDs as the authority for post and attachment content, with `data/index.json` as a derived local discovery index.
- Treat the browser P2P board as the only client board surface; the Node process may host static assets, signaling, and a verified mirror, but not a selectable server-backed board mode.
- Treat GitHub Pages as a serverless P2P build: it must not call app-owned `/api` helpers, but it should use Helia's public browser IPFS networking for delegated routing, Bitswap/WebRTC transport, and trustless gateway retrieval.
- Render the client in a retro terminal style with no React or TypeScript.
- Prefer headless tests for repository, IPFS, and API behavior before adding demos.

## Completed Foundation

- Express API routes for tags, tagged thread summaries, thread fetch, thread creation, replies, imports, reset, and file streaming.
- Helia DAG-JSON post storage and UnixFS attachment storage backed by the local filesystem.
- Local JSON index for posts, threads, tags, post counts, and last activity.
- Vite client for tag browsing, thread creation, thread opening, replies, CID imports, and attachment display.
- Shareable URL state for tag and thread views using `?tag=<tag>&thread=<rootCid>`.
- Browser-owned P2P board mode using Helia, DAG-JSON, UnixFS, IndexedDB blocks, and URL state shaped as `?board=<boardCid>&tag=<tag>&thread=<rootCid>`.
- Vitest/Supertest coverage for repository behavior, IPFS round trips, and API workflows.
- Dockerfile, Compose config, health route, graceful shutdown, and smoke script for deployable runtime validation.

## 2026-06-28 Slice

- Added a filesystem blockstore adapter so Helia DAG-JSON reads receive `Uint8Array` bytes from `blockstore-fs`.
- Added explicit thread pre-order traversal so replies render parent-before-child instead of a flat created-time list.
- Added `depth` and `replyCount` metadata to thread API post records for nested reply rendering.
- Added recursive import of a reply CID's ancestor chain when the ancestor blocks are locally available.
- Fixed tag thread summaries to expose the root attachment as `attachment` while keeping `rootAttachment` for compatibility.
- Updated the client to indent nested replies and show short parent CID references.
- Tightened the client style toward the retro terminal direction.
- Created the required `plan/` documentation set and moved current planning authority here from the legacy `imp-*` files.

## 2026-06-28 Deployment Slice

- Upgraded direct dependencies to current supported releases for Node 24: Express 5, Helia 6, libp2p 3, Vite 8, Vitest 4, and matching IPFS/libp2p packages.
- Removed the earlier Helia 5 byte-array blockstore adapter because Helia 6 expects native async iterable blockstore reads.
- Added environment-driven config for `HOST`, `PORT`, `DATA_DIR`, `IPFS_OFFLINE`, `MAX_BODY_BYTES`, and `MAX_FILE_BYTES`.
- Added `/api/health` with index counts and local IPFS storage readiness.
- Added graceful SIGTERM/SIGINT shutdown that closes the HTTP server and Helia node.
- Added Supertest API coverage for health, create thread, reply, tag listing, thread tree, file streaming, reset, and import after index reset.
- Added `scripts/smoke.js` plus `npm run smoke` and `npm run verify`.
- Added a visible client import form for known post CIDs.
- Added `Dockerfile`, `.dockerignore`, and `compose.yaml`; verified the built container and Docker health check locally.
- Added `plan/deploy.md` and updated README deployment instructions.

## 2026-06-30 Shareable Thread URLs

- Added browser URL state for tags and threads.
- Opening a thread now pushes `?tag=<tag>&thread=<rootCid>`.
- Reply submission keeps the current thread open instead of clearing the thread view during tag refresh.
- Direct visits to a thread URL restore the active tag, thread list, active thread, nested posts, and copy-link button.
- Added a visible per-thread `Link` action and active-thread `Copy Link` button.
- Added browser back/forward handling with `popstate`.

## 2026-06-30 Browser Helia Board Mode

- Added a separate P2P board mode that keeps the server-backed board intact.
- Added browser-side board manifests with type `ipfschan-board/v1`; each board CID points to a DAG-JSON manifest of post CIDs.
- Added browser Helia storage with `IDBBlockstore`, DAG-JSON posts, and UnixFS attachments.
- Added Board Mode controls for switching server/P2P mode, creating a new board, loading a board CID, and copying the current board URL.
- Added route state for P2P boards: `mode=p2p`, `board=<boardCid>`, `tag=<tag>`, and `thread=<rootCid>`.
- Creating a P2P thread publishes a new board CID, opens the thread, and updates the URL.
- Replying in P2P mode publishes a new board CID while keeping the same thread root in the URL.
- Added shared rendering so attachments come from `/api/file/<cid>` in server mode and browser Helia/UnixFS blob URLs in P2P mode.
- Added client board-model unit tests for tag counts, thread ordering, tree depth, tag normalization, and manifest normalization.
- Pinned `blockstore-idb` to the Helia-compatible 3.x line and `multiformats` to 13.4.x after the latest 4.x/14.x stack produced incompatible CID classes with Helia 6's UnixFS path.

## 2026-06-30 P2P Availability Fix

- Reproduced that P2P board links worked only in the creator's browser profile because the board/post/file blocks lived only in that profile's IndexedDB.
- Added a server-assisted availability mirror for P2P board snapshots at `/api/p2p/mirror`.
- The mirror verifies browser-authored board, post, and attachment CIDs before storing blocks in the server Helia node.
- Fresh browsers can now open copied P2P board URLs through `/api/p2p/board/<boardCid>` when direct browser block retrieval is unavailable.
- P2P attachment rendering now falls back to `/api/p2p/file/<cid>` when the local browser Helia node does not have the file bytes.
- The UI reports when a board was loaded from the availability mirror and when a publish was mirrored.

## 2026-06-30 Live Peer Block Exchange

- Added server-side P2P signaling and provider lookup under `/api/p2p/signal/:peerId`, `/api/p2p/providers`, and `/api/p2p/providers/:boardCid`.
- Added a browser WebRTC data-channel block exchange that transfers raw IPFS blocks directly between open browser tabs.
- P2P board loading now tries local IndexedDB first, then live browser peers, then the server availability mirror.
- Browser providers announce board CIDs after local load, mirror load, and publish so other fresh browsers can find them while the tab stays open.
- Fresh browsers can now load board and post blocks from a live creator browser and display `board ready from live peer`.
- Attachment root blocks are prefetched from the live peer during board load so small P2P attachments render as browser `blob:` URLs without using `/api/p2p/file`.
- The server mirror remains as a fallback when no provider tab is online or WebRTC negotiation fails.

## 2026-06-30 Terminal Monitor UI Makeover

- Reworked the client shell into a deno_tui-inspired terminal monitor surface instead of the earlier flat panel stack.
- Added persistent mode, board, tag, and thread readouts to make URL state and selected context obvious.
- Reframed board mode, tags, composer, thread list, import, and active thread as responsive terminal panes.
- Tightened command controls, file inputs, thread cards, nested replies, attachment links, and empty states for practical use.
- Added desktop, mobile, and active-thread screenshot checks against the live HTTPS instance after the production build.

## 2026-07-01 P2P Image Attachment Work

- Added a peer-backed browser blockstore wrapper so UnixFS reads can fetch missing blocks from existing WebRTC data-channel peers.
- Added attachment-level WebRTC file-byte requests for P2P images and larger attachments when block-level UnixFS traversal is not enough.
- Re-add peer-sourced attachment bytes through browser Helia and verify the resulting CID before exposing a `blob:` URL.
- Kept the verified server mirror as a fallback when no live peer is open, the peer request fails, or CID verification fails.
- Added focused client tests for block collection and peer-backed blockstore fallback behavior.

## 2026-07-01 GitHub Initial Publish

- Initialized this directory as a Git repository for `ubernaut/ipfschan`.
- Kept generated/runtime paths such as `node_modules/`, `dist/`, `data/`, and `.local/` ignored for the initial source commit.
- Used the existing Node 24 verification gate before publishing the initial branch.

## 2026-07-01 GitHub Pages Build

- Added `npm run build:pages` to emit a Vite Pages build into `docs/` with the `/ipfschan/` base path.
- Added a browser-only Pages mode that defaults to local P2P board mode instead of trying to call missing GitHub Pages `/api` routes.
- Pages mode starts Helia with local-only storage settings so IndexedDB boards can publish without waiting on libp2p networking.
- Pages mode skips server mirror and signaling calls; it can create and reload local browser boards from IndexedDB, but cross-browser sharing still requires the Node app.
- Added `docs/.nojekyll` so GitHub Pages serves Vite's asset paths directly.

## 2026-07-01 Public IPFS Relay/Gateway Direction

- Public IPFS utilities can help with retrieval: delegated routing at `https://delegated-ipfs.dev/routing/v1`, public gateways such as `https://ipfs.io` and `https://dweb.link`, and trustless gateway fallback at `https://trustless-gateway.link`.
- These are not a direct replacement for the app's provider registry, WebRTC signaling, or availability mirror because browser-authored board blocks still need to be announced, reachable, and retained somewhere.
- A practical Pages-compatible next slice is to add an explicit public-retrieval mode for CIDs already available on IPFS while keeping our Node service or a self-hosted relay/mirror as the reliable path for freshly authored boards.

## 2026-07-01 P2P-Only Client Direction

- Removed the selectable server-backed board mode from the client.
- The client always boots into a browser Helia board and no longer calls the normal thread/tag/reply/import API paths.
- P2P URLs no longer emit the redundant `mode=p2p` parameter; old links with that parameter remain harmless because route parsing ignores it.
- The Node service remains useful as an optional static host, WebRTC signaling endpoint, and CID-verifying availability mirror.

## 2026-07-01 Public IPFS Pages Networking

- Replaced the GitHub Pages local-only Helia settings with Helia's default browser networking stack while still skipping app-specific `/api/p2p/*` signaling and mirror calls.
- Pages startup now creates Helia without blocking on public networking, then starts the public IPFS node in the background so local board creation can remain responsive.
- Pages board loads wait on the public node, then retry abortable Helia retrieval attempts through public routing, Bitswap/WebRTC, and trustless gateways before reporting that a board CID is unreachable.
- Pages publishes launch bounded public provider announcements for the board, post, and attachment CIDs in the background and report pending, complete, or incomplete announcement state in the terminal status line.

## Next Useful Work

1. Deploy to a named target and attach durable storage or a volume for `/data`.
2. Validate and harden public IPFS reachability for browser-authored Pages CIDs; if public provider announcement is not reliable enough, add a real public pinning or relay handoff that still keeps the board surface P2P-first.
3. Harden the live peer path with richer peer diagnostics, TURN/relay configuration for NAT-hostile networks, larger attachment transfer coverage, and automated browser coverage.
4. Add moderation and trust controls before exposing a public writable instance.
5. Preserve and display richer thread tree context, such as focused reply target anchors and collapsible subtrees.
6. Add backup/restore tooling for `data/index.json`, server IPFS blocks, and browser board exports.
7. Add networked IPFS validation with `IPFS_OFFLINE=false` and browser-to-browser retrieval once the deployment environment is chosen.
