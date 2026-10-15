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
  const passkeyFile = file.replace('sign-in.ts', 'passkeys.ts')
  const compiled = await (await fetch(`${base}/@fs${passkeyFile}`)).text()
  const endpoints = Object.fromEntries(
    [...compiled.matchAll(/export const (\w+) = [^;]+?createClientRpc\("([^"]+)"/g)].map(
      (match) => [match[1], `${base}/_serverFn/${match[2]}`]
    )
  )
  assert.equal(Object.keys(endpoints).length, 12, 'all passkey functions compiled')
  const sid = '00000000-0000-4000-8000-000000000001'
  const userId = '00000000-0000-4000-8000-000000000002'
  const bearer = 'a'.repeat(43)
  const inputs = {
    passkeySignInOptions: {},
    passkeySignIn: { ceremonyId: bearer, response: {} },
    passkeyPasswordProof: {
      expectedSessionId: sid,
      password: 'legacy',
      action: { purpose: 'enroll' },
    },
    passkeyProofOptions: { expectedSessionId: sid, action: { purpose: 'enroll' } },
    passkeyProof: { expectedSessionId: sid, ceremonyId: bearer, response: {} },
    passkeyEnrollmentOptions: { expectedSessionId: sid, grantId: bearer },
    passkeyEnrollment: { expectedSessionId: sid, ceremonyId: bearer, response: {}, name: 'Device' },
    passkeyList: { expectedSessionId: sid },
    passkeyRename: { expectedSessionId: sid, credentialRecordId: userId, name: 'Device' },
    passkeyRemove: { expectedSessionId: sid, grantId: bearer },
    passkeyManagementContext: { expectedSessionId: sid },
  }
  const passkeyPost = (name, data, extraHeaders = {}, contextSid = sid) =>
    fetch(endpoints[name], {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tsr-serverFn': 'true',
        origin: base,
        ...extraHeaders,
      },
      body:
        typeof data === 'string'
          ? data
          : JSON.stringify(toJSON({ data, context: { bylineExpectedSessionId: contextSid } })),
    })
  for (const [name, data] of Object.entries(inputs)) {
    const response = await passkeyPost(name, data)
    const content = await response.text()
    assert.equal(response.status, 200, `${name}: ${content}`)
    assert.equal(response.headers.get('cache-control'), 'no-store', name)
    const limit = name === 'passkeyPasswordProof' ? 16 * 1024 : 64 * 1024
    assert.equal((await passkeyPost(name, 'x'.repeat(limit + 1))).status, 413, `${name} body limit`)
    assert.equal(
      (await passkeyPost(name, 'x'.repeat(limit + 1), { origin: 'https://attacker.invalid' }))
        .status,
      403,
      `${name} CSRF first`
    )
    assert.equal(
      (await passkeyPost(name, '{}', { 'content-type': 'multipart/form-data' })).status,
      415,
      `${name} JSON required`
    )
  }
  for (const name of Object.keys(inputs).filter(
    (name) => !['passkeySignInOptions', 'passkeySignIn'].includes(name)
  )) {
    const changed = await passkeyPost(name, inputs[name], {}, userId)
    assert.equal(changed.headers.get('x-byline-auth-boundary'), 'changed', name)
    assert.equal(changed.headers.get('x-test-cookies'), null)
    const expired = await passkeyPost(name, inputs[name], { 'x-test-expired': 'true' })
    assert.equal(expired.headers.get('x-byline-auth-boundary'), 'renew', name)
    assert.equal(expired.headers.get('cache-control'), 'no-store', name)
  }
  const selfRemoval = await passkeyPost('passkeyRemove', inputs.passkeyRemove, {
    'x-test-self-removal': 'true',
  })
  assert.equal(selfRemoval.headers.get('x-test-cookies'), 'cleared')
  assert.equal(selfRemoval.headers.get('x-test-preview'), 'cleared')
  const recoveryRemoval = await passkeyPost('passkeyRemove', inputs.passkeyRemove)
  assert.equal(recoveryRemoval.headers.get('x-test-cookies'), null)
  console.log(
    'Real Start passkey transport: all 11 POST routes bounded, CSRF first, expected-login/expiry boundaries, and conditional cookie clearing verified.'
  )
  console.log(
    'Real Start sign-in transport: provider reached, body bounded, CSRF precedes body guard.'
  )
} finally {
  await server.close()
}
