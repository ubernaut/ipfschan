# Deployment Notes

ipfschan is now deployable as a single Node 24 container. The service serves the Vite-built client, the Express API, and local Helia/IPFS storage from one process.

## Local Container

Build:

```sh
docker build -t ipfschan:local .
```

Run:

```sh
docker run -d --name ipfschan -p 4000:4000 -v ipfschan-data:/data ipfschan:local
```

Health:

```sh
curl http://localhost:4000/api/health
```

Stop:

```sh
docker stop ipfschan
```

## Compose

```sh
docker compose up -d --build
```

The Compose file maps port `4000` and stores app data in the named volume `ipfschan-data`.

## Runtime Configuration

- `HOST`: bind address. The Docker image sets `0.0.0.0`.
- `PORT`: HTTP port. The Docker image sets `4000`.
- `DATA_DIR`: persistent data path. The Docker image sets `/data`.
- `IPFS_OFFLINE`: defaults to `true`; set `false` only when the host should participate in libp2p networking.
- `MAX_BODY_BYTES`: JSON request limit. Default is 2 MiB.
- `MAX_FILE_BYTES`: attachment limit. Default is 25 MiB.
- `HTTPS`: set to `true` to serve HTTPS directly from Node.
- `HTTPS_KEY_FILE`: private key path when `HTTPS=true`.
- `HTTPS_CERT_FILE`: certificate path when `HTTPS=true`.

## VPN HTTPS Test Run

For local VPN testing with a self-signed certificate:

```sh
HOST=0.0.0.0 PORT=4443 HTTPS=true \
  HTTPS_KEY_FILE=/home/cos/projects/ipfschan/.local/certs/ipfschan.key \
  HTTPS_CERT_FILE=/home/cos/projects/ipfschan/.local/certs/ipfschan.crt \
  npm start
```

The browser will warn about the self-signed certificate unless the certificate is trusted locally. The cert used for the 2026-06-30 test included SANs for `localhost`, `127.0.0.1`, `192.168.1.42`, and `100.86.83.35`.

## Verified On 2026-06-28

- `npm run verify` passed.
- `npm audit --json` reported zero vulnerabilities.
- `docker build -t ipfschan:local .` passed.
- A disposable container from `ipfschan:local` returned HTTP 200 from `/api/health`.
- Docker reported the disposable container health as `healthy`.
- The disposable container served the built app shell from `/`.
- No disposable container was left running after validation.

## Deployment Caveats

- Offline mode is the current default. A deployed instance can create, index, import, and serve locally available IPFS blocks, but public peer discovery and remote block fetching still need target-environment validation.
- There is no authentication, moderation, spam control, or write-rate limiting yet. Do not expose a public writable board without adding those controls.
- Persistent storage is required. Losing `/data` loses the local index and locally hosted IPFS blocks.
