// Builds the real sign-in and passkey server functions with Nitro's `node`
// preset, starts the built server, and checks over HTTP that a Response thrown
// from a server function keeps its status. Unit tests cannot catch this: they
// run on Node's native Response, while Nitro can swap the global for srvx's
// FastResponse, which lost the status (h3js/srvx#343).
//
// `--expect-regression` builds with Nitro's own feature defaults instead of
// `bylineNitroFeatures()` and passes only when the statuses are wrong. Use it
// to check whether a Nitro or srvx upgrade has fixed the upstream bug: once it
// fails, the workaround in `bylineNitroFeatures()` can go.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import { createBuilder } from 'vite'

const here = (file) => fileURLToPath(new URL(file, import.meta.url))
const expectRegression = process.argv.includes('--expect-regression')

const reactRequire = createRequire(import.meta.resolve('@tanstack/react-start'))
const startRequire = createRequire(reactRequire.resolve('@tanstack/start-server-core/package.json'))
const { toJSON } = startRequire('seroval')

if (expectRegression) process.env.BYLINE_TEST_NITRO_FEATURES = 'default'
const builder = await createBuilder({ configFile: here('./vite.config.ts') })
await builder.buildApp()

// Production server-function ids are hashes; read them from the built SSR graph.
const ssrDir = here('./.output/server/_ssr/')
const ssr = readdirSync(ssrDir)
  .map((file) => readFileSync(`${ssrDir}${file}`, 'utf8'))
  .join('\n')
const ids = Object.fromEntries(
  [...ssr.matchAll(/var (\w+) = createServerFn\([\s\S]*?createSsrRpc\("([0-9a-f]+)"\)/g)].map(
    (match) => [match[1], match[2]]
  )
)
assert.ok(ids.adminSignIn && ids.passkeySignInOptions, 'server function ids not found in build')

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [here('./.output/server/index.mjs')], {
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) },
  stdio: ['ignore', 'inherit', 'inherit'],
})

try {
  let ready = false
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = await fetch(base).then(
      () => true,
      () => new Promise((resolve) => setTimeout(() => resolve(false), 100))
    )
  }
  assert.ok(ready, 'built server did not start')

  const post = (name, data) =>
    fetch(`${base}/_serverFn/${ids[name]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tsr-serverFn': 'true', origin: base },
      body: JSON.stringify(toJSON({ data })),
    })
  const cases = [
    ['adminSignIn', { email: 'not-an-email' }, 400, 'Invalid sign-in input'],
    ['passkeySignInOptions', { unexpected: true }, 400, 'Invalid passkey input'],
  ]
  const statuses = []
  for (const [name, data, status, body] of cases) {
    const response = await post(name, data)
    assert.equal(await response.text(), body, `${name}: body`)
    statuses.push([name, response.status, status])
  }

  if (expectRegression) {
    const lost = statuses.filter(([, actual, expected]) => actual !== expected)
    assert.ok(
      lost.length > 0,
      'Nitro defaults now keep thrown Response statuses: h3js/srvx#343 looks fixed, so ' +
        'the fastResponse workaround in bylineNitroFeatures() can be removed'
    )
    console.log(
      `Nitro defaults still lose thrown Response statuses (${lost
        .map(([name, actual, expected]) => `${name}: ${actual}, expected ${expected}`)
        .join('; ')}). Keep bylineNitroFeatures().`
    )
  } else {
    for (const [name, actual, expected] of statuses) assert.equal(actual, expected, name)
    console.log(
      'Built Nitro server: Responses thrown from sign-in and passkey server functions keep their status.'
    )
  }
} finally {
  server.kill()
}
