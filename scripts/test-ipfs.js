import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { createIpfs } from '../src/server/ipfs.js'
import { CID } from 'multiformats/cid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, '../data-test')

async function run() {
  console.log('Setting up test IPFS in', dataDir)
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  fs.mkdirSync(dataDir, { recursive: true })

  try {
    // We need to use the exported blockstore
    const { files, blockstore } = await createIpfs({ dataDir, offline: true })

    const content = new TextEncoder().encode('Hello IPFS World ' + Date.now())
    console.log('Adding content:', new TextDecoder().decode(content))

    // Try addBytes
    let cid;
    try {
        console.log('Attempting addBytes...')
        cid = await files.addBytes(content)
        console.log('Added CID (addBytes):', cid.toString())

        console.log('Reading back (cat)...')
        try {
          const stream = files.cat(cid)
          for await (const chunk of stream) {
             // consume
          }
          console.log('addBytes/cat success')
        } catch (unixFsErr) {
            console.log('unixFs cat failed:', unixFsErr.message)

            console.log('Attempting blockstore fallback...')
            const blockOrGen = await blockstore.get(cid)

            let block = blockOrGen;
            // Check if it's an async generator or iterable
            if (blockOrGen && typeof blockOrGen[Symbol.asyncIterator] === 'function') {
                console.log('Blockstore returned async iterator, consuming...')
                const chunks = []
                for await (const chunk of blockOrGen) {
                    chunks.push(chunk)
                }
                block = Buffer.concat(chunks)
            }

            console.log('Block type:', typeof block)
            console.log('Constructor:', block?.constructor?.name)
            console.log('Length:', block.length)

            if (block) {
                console.log('Decoded:', new TextDecoder().decode(block))
            }
        }

    } catch (e) {
        console.log('Overall failure:', e)
    }

  } catch (err) {
    console.error('Setup Error:', err)
  } finally {
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

run()
