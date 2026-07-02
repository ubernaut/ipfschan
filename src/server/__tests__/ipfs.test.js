import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { createIpfs } from '../ipfs.js'

let helia
let dataDir

async function createTempIpfs() {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ipfschan-ipfs-'))
  const ipfs = await createIpfs({ dataDir, offline: true })
  helia = ipfs.helia
  return ipfs
}

async function collect(source) {
  const chunks = []
  let totalLength = 0
  for await (const chunk of source) {
    chunks.push(chunk)
    totalLength += chunk.byteLength
  }
  const output = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

afterEach(async () => {
  if (helia?.stop) {
    await helia.stop()
  }
  rmSync(dataDir, { recursive: true, force: true })
  helia = null
  dataDir = null
})

describe('createIpfs', () => {
  it('round-trips DAG-JSON blocks from the filesystem blockstore', async () => {
    const { dag } = await createTempIpfs()
    const cid = await dag.add({ title: 'hello', tags: ['ipfs'] })

    await expect(dag.get(cid)).resolves.toEqual({
      title: 'hello',
      tags: ['ipfs']
    })
  })

  it('round-trips UnixFS bytes from the filesystem blockstore', async () => {
    const { files } = await createTempIpfs()
    const bytes = new TextEncoder().encode('file bytes')
    const cid = await files.addBytes(bytes)

    const result = await collect(files.cat(cid))
    expect(new TextDecoder().decode(result)).toBe('file bytes')
  })
})
