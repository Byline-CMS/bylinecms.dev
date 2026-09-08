import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { createServer } from 'vite'

const reactRequire = createRequire(import.meta.resolve('@tanstack/react-start'))
const startRequire = createRequire(reactRequire.resolve('@tanstack/start-server-core/package.json'))
const { toJSON } = startRequire('seroval')
const server = await createServer({
  configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
})
try {
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  const file = fileURLToPath(
    new URL(
      '../../../../packages/host-tanstack-start/src/server-fns/auth/sign-in.ts',
      import.meta.url
    )
  )
  const moduleResponse = await fetch(`${base}/@fs${file}`)
  assert.equal(moduleResponse.status, 200)
  const moduleText = await moduleResponse.text()
  const id = /createClientRpc\("([^"]+)"/.exec(moduleText)?.[1]
  assert.ok(id, 'Start must compile the real sign-in server function')
  const endpoint = `${base}/_serverFn/${id}`
  const post = (body, origin = base) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tsr-serverFn': 'true', origin },
      body,
    })
  const body = JSON.stringify(
    toJSON({ data: { email: 'transport@example.test', password: 'legacy' } })
  )
  const allowed = await post(body)
  const text = await allowed.text()
  assert.equal(allowed.status, 200, text)
  assert.ok(text.includes('transport-verified'), text)
  assert.equal((await post('x'.repeat(17_000))).status, 413)
  assert.equal((await post('x'.repeat(17_000), 'https://attacker.invalid')).status, 403)
  console.log(
    'Real Start sign-in transport: provider reached, body bounded, CSRF precedes body guard.'
  )
} finally {
  await server.close()
}
