# Implementation Plan

Goal: rebuild the IPFS-backed imageboard from scratch so that each user hosts their own posts/media on IPFS, while the app aggregates tags, threads, and replies.

## Approach Overview
- Start fresh: remove previous attempt, reinitialize npm, and set up a clean src/ layout for server and client.
- Use Helia for IPFS operations (files via `@helia/unixfs`, metadata via DAG-JSON) so every post lives on IPFS and references its parent by CID.
- Keep a local index (JSON on disk) to quickly derive tags, threads, and activity, while still resolving content and attachments from IPFS.
- Provide a small Express API for posts, tags, threads, and file streaming; front-end consumes it via fetch.
- Bundle the client with Vite (ESM) for compatibility; all code stays in ES modules.
- Test with Vitest + Supertest using an in-memory Helia node to avoid network dependence in CI.

## Target Functionality (derived from requirements)
- Home: list all tags sorted by popularity.
- Tag view: list all threads carrying that tag, sorted by most recent post in each thread.
- Create thread: requires at least one tag, a title, body text; optional file (image/gif/webm/mp4/any).
- Replies: every post references its parent CID; thread view shows all descendants from the root.
- Ownership: posts and attachments are added to the local Helia node so the author hosts what they create.

## Planned Steps
1) **Reset and scaffold**
   - Delete old `public/`, `server.js`, and existing bundles/configs.
   - `npm init -y`, set `"type": "module"`, define scripts (`dev`, `build`, `start`, `test`, `lint` if needed).
   - Add `.gitignore` (node_modules, dist, coverage, data).
   - Install runtime deps: `express@^4`, `multer@^1.4.5-lts.1`, `helia@^5`, `@helia/unixfs@^5`, `@helia/dag-json@^4`, `libp2p` defaults, `cors` if needed.
   - Install dev deps: `vite@^5`, `vitest@^1`, `supertest@^6`, `eslint` (optional), `@vitejs/plugin-legacy` if needed for compatibility.

2) **Directory and config layout**
   - `src/server` for API, IPFS wiring, and persistence.
   - `src/client` for Vite entry, views, and assets.
   - `data/` for persisted index/IPFS storage.
   - `vite.config.js` aligned with ESM output and Express static serving of `dist/`.

3) **Data model and indexing**
   - Post shape: `{ cid, parentCid|null, threadRootCid, tags[], title, body, createdAt, attachment?: { cid, name, mime, size }, links?: [] }`.
   - Tags live on thread roots; replies inherit thread tags for querying.
   - Tag popularity: count total posts within threads that include the tag (weights threads by activity).
   - Thread activity: derive `lastActivity` from latest `createdAt` among posts under that root.
   - Store a local `index.json` with `postsByCid`, `threads` (rootCid -> member CIDs, lastActivity, tag set), and lightweight caches.
   - Implement index persistence with atomic writes and validation (strip oversized fields, cap body length, cap tags).

4) **IPFS integration**
   - Create a Helia node configured for Node with TCP/WebSockets, Noise, and Yamux; persist blockstore under `data/ipfs`.
   - Utilities to add files to UnixFS (stream from multer), add post metadata as DAG-JSON, fetch posts/files by CID, and pin created content.
   - Include an import routine to pull an externally known post CID (and its ancestors) into the local index, so remote contributions can be viewed.

5) **Persistence layer**
   - `PostRepository`: read/write index, ensure parent existence, normalize tags, enforce size limits, compute derived fields (threadRoot, lastActivity).
   - Provide functions: `createThread`, `replyToPost`, `getTags`, `getThreadsByTag`, `getThreadTree`, `importPost`.
   - Make repository accept a Helia client so tests can inject an in-memory node.

6) **API layer (Express)**
   - Routes:
     - `GET /api/tags` -> tag list with popularity counts.
     - `GET /api/tags/:tag/threads` -> threads for that tag with last activity and counts.
     - `GET /api/thread/:rootCid` -> full thread tree (posts ordered by createdAt, include parent refs and attachments).
     - `POST /api/thread` -> create root thread (title, body, tags[], optional file upload).
     - `POST /api/thread/:parentCid/reply` -> reply with inherited tags, optional file.
     - `POST /api/import` -> import an existing post CID into the local index.
     - `GET /api/file/:cid` -> stream attachment by CID with correct headers.
   - Middlewares: JSON parser, multer with file size/type limits, error handling with consistent response shape, CORS if running client separately.

7) **Client (Vite, ESM)**
   - Views: Home (tag cloud/list), Tag Threads list, Thread detail (nested replies), New Thread form, Reply form.
   - State/data service: fetch wrapper for API, handles loading/error surfaces.
   - UI behavior: optimistic submit spinners, attachment preview where possible, collapsible reply threads, link to IPFS CID.
   - Styling: simple but readable layout; responsive column that works on mobile/desktop.

8) **Testing**
   - Configure Vitest to run both unit and API integration tests via `npm run test`.
   - Use an in-memory Helia instance for fast tests; stub persistence to temp dirs.
   - Tests:
     - Repository: tag counts, thread activity ordering, inheritance of tags, parent validation.
     - IPFS utils: add/read DAG and files round-trip (memory).
     - API: happy-path thread creation, reply with file (use buffers), tag list ordering, thread fetch ordering.
     - Minimal client tests for data formatting helpers (if present).

9) **Build and run workflow**
   - `npm run dev`: Vite dev server + API proxy or concurrently run Express.
   - `npm run build`: Vite build to `dist`, copy static assets, ready for `npm start`.
   - `npm start`: start Express in production mode serving `dist` and API.
   - Document environment variables (ports, data dir, max upload size).

10) **Logging and resilience**
   - Add basic request logging and error logging to console.
   - Handle malformed CIDs gracefully with 400s; guard against oversized payloads.
   - Pin created CIDs to reduce accidental GC; expose hook to unpin in future work.

11) **Documentation**
   - Keep README updated with how to run, test, and share posts (including the ownership/IPFS story).
   - Maintain `imp-log.md` with significant choices and deviations as implementation proceeds.
