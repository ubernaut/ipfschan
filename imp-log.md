# Implementation Log

- Initialized fresh planning pass; documenting requirements and discarding prior attempt before rebuilding.
- Chose Helia (UnixFS + DAG-JSON) as the IPFS layer so posts and attachments are hosted by the creator and linked by CID parent references.
- Selected Express for the API, Vite for the client bundle, and Vitest + Supertest for testing to maximize compatibility and ES module support.
- Reinitialized npm, added libp2p transports, Helia, Express, Vite, Vitest, and Supertest; scaffolded server/client folders with ESM throughout and created a Vite config for `src/client`.
- Added offline-friendly Helia creation, Promise.withResolvers polyfill, and repository-focused tests (Vitest) to avoid binding sockets in constrained environments.
- Added CustomEvent polyfill in IPFS bootstrap to avoid server crashes and 500s when creating threads.
- Defaulted server to offline Helia and forced Vite proxy to 127.0.0.1 to avoid IPv6/loopback refusal errors in dev.
