# IPFS Imageboard (ipfschan)

IPFS-hosted imageboard rebuilt from scratch. The goal is to let each user host their own posts and media on IPFS, while the app aggregates threads, tags, and replies.

## Functional Requirements
- Root page lists all tags sorted by popularity (most used tags first).
- Selecting a tag shows all threads carrying that tag, sorted by most recent post activity.
- Users can create new threads with at least one tag, a title, and body text; media (image/gif/webm/mp4/any file) is optional.
- Every post is owned/hosted by its author on IPFS and references the parent post it replies to (thread roots have no parent).
- Opening a thread shows every post descending from the root, in-thread tree order.

## Current Status
- Express API, Helia/IPFS storage, Vite client, container packaging, and Vitest/Supertest coverage are in place.
- Thread fetches now return parent-before-child tree order with reply depth metadata.
- Importing a known reply CID imports its locally available ancestor chain into the index.
- The app exposes `/api/health`, supports graceful shutdown, and can run with a persistent `DATA_DIR`.
- The client has a P2P Board Mode where the browser runs Helia, stores blocks in IndexedDB, publishes board manifests as DAG-JSON CIDs, and keeps URLs shareable as `?mode=p2p&board=<boardCid>&tag=<tag>&thread=<rootCid>`.
- P2P Board Mode can transfer board/post blocks directly from a live browser peer over WebRTC data channels. It also mirrors browser-authored board snapshots to the server Helia node after verifying the claimed CIDs, so copied board links still work when no provider tab is online.
- P2P attachments use browser Helia first, then an app-level WebRTC file-byte request to an open provider, then the verified server mirror as a fallback.
- The client UI now uses a dense retro terminal monitor layout inspired by the local `deno_tui` app, with board/tag/thread readouts, scrollable panes, and responsive desktop/mobile framing.
- See `plan/plan.md` for the build plan, `plan/log.md` for the implementation log, `plan/tests.md` for testing strategy, and `plan/deploy.md` for deployment notes.

## Getting Started
1. Install Node.js 24 LTS.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Development:
   - API + client together: `npm run dev` (Express on 4000, Vite dev server proxying /api).
   - API only: `npm run dev:server`.
   - Client only: `npm run dev:client`.
4. Production build:
   ```sh
   npm run build
   npm start
   ```
5. Tests:
   ```sh
   npm run test
   ```
6. Full local verification:
   ```sh
   npm run verify
   ```

## Deployment

GitHub Pages static build:

```sh
npm run build:pages
```

This writes the browser-only Pages build to `docs/` with a `/ipfschan/` base path. The Pages build defaults to local P2P board mode because GitHub Pages cannot serve the Node `/api`, WebRTC signaling, or mirror endpoints.

Container build:

```sh
docker build -t ipfschan:local .
```

Run with persistent storage:

```sh
docker run -d --name ipfschan -p 4000:4000 -v ipfschan-data:/data ipfschan:local
```

Or use Compose:

```sh
docker compose up -d --build
```

Health check:

```sh
curl http://localhost:4000/api/health
```

Deployment environment variables:

- `PORT`: HTTP port, default `4000`.
- `HOST`: bind host, default `0.0.0.0` in production and `127.0.0.1` in development.
- `DATA_DIR`: persistent index and IPFS block storage path, default `data/` locally and `/data` in the container.
- `IPFS_OFFLINE`: defaults to `true`; set `false` to enable libp2p networking.
- `MAX_BODY_BYTES`: JSON body limit, default 2 MiB.
- `MAX_FILE_BYTES`: attachment upload limit, default 25 MiB.
- `HTTPS`: set to `true` to serve HTTPS directly from Node.
- `HTTPS_KEY_FILE`: private key path when `HTTPS=true`.
- `HTTPS_CERT_FILE`: certificate path when `HTTPS=true`.

## Notes
- Posts and attachments are added to the local Helia node so the author hosts their own content; the app indexes metadata in `data/index.json`.
- In P2P Board Mode, posts, attachments, and the board manifest are authored by browser Helia instead of the normal thread/reply Express API. Fresh browsers try local IndexedDB, then a live WebRTC peer, then the CID-verified server availability mirror.
- API endpoints live under `/api` (see `src/server/routes.js`).
- The server defaults to IPFS offline mode to avoid network interface issues in restricted environments. Set `IPFS_OFFLINE=false` to enable libp2p networking.
- The current Helia 6 stack uses the native async-iterable filesystem blockstore contract.
