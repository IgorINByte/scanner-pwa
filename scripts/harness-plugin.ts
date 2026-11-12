// Dev-server endpoints for the detection test harness (/harness.html). Dev only: the
// harness page is not part of the production build.
//   GET  /__harness/images        list of image files in test-images/
//   GET  /__harness/ground-truth  test-images/ground-truth.json (or an empty set)
//   POST /__harness/ground-truth  overwrite ground-truth.json
//   POST /__harness/results       append a markdown section to docs/detection-benchmark.md
//   GET  /__harness/fixtures      image files per folder of test/fixtures/ (/fixtures.html)
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const IMAGE_RE = /\.(jpe?g|png|webp|hei[cf])$/i

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function harnessPlugin(root: string): Plugin {
  const dir = join(root, 'test-images')
  const gtFile = join(dir, 'ground-truth.json')
  const docFile = join(root, 'docs', 'detection-benchmark.md')
  return {
    name: 'detection-harness',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__harness', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          if (req.method === 'GET' && req.url === '/fixtures') {
            const fx = join(root, 'test', 'fixtures')
            const folders = existsSync(fx) ? readdirSync(fx, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []
            return send(200, Object.fromEntries(folders.map((c) => [c, readdirSync(join(fx, c)).filter((f) => IMAGE_RE.test(f)).sort()])))
          }
          if (req.method === 'GET' && req.url === '/images') {
            return send(200, existsSync(dir) ? readdirSync(dir).filter((f) => IMAGE_RE.test(f)).sort() : [])
          }
          if (req.url === '/ground-truth') {
            if (req.method === 'GET') {
              return send(200, existsSync(gtFile) ? JSON.parse(readFileSync(gtFile, 'utf8')) : { version: 1, images: {} })
            }
            if (req.method === 'POST') {
              const gt = JSON.parse(await readBody(req))
              mkdirSync(dir, { recursive: true })
              writeFileSync(gtFile, JSON.stringify(gt, null, 2) + '\n')
              return send(200, { ok: true })
            }
          }
          if (req.method === 'POST' && req.url === '/results') {
            const { markdown } = JSON.parse(await readBody(req))
            mkdirSync(join(root, 'docs'), { recursive: true })
            appendFileSync(docFile, '\n' + String(markdown))
            return send(200, { ok: true })
          }
          send(404, { error: 'not found' })
        } catch (e) {
          send(500, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}
