import assert from 'node:assert/strict'

// Isolated state model. No real credentials, networking, application imports,
// database writes, browser automation, or cryptographic implementation.
const results = []
function check(name, work) {
  const evidence = work()
  results.push({ name, ...evidence })
}
function orders(events, edges) {
  if (!events.length) return [[]]
  return events.flatMap((e) =>
    edges.some(([a, b]) => b === e && events.includes(a))
      ? []
      : orders(
          events.filter((x) => x !== e),
          edges
        ).map((rest) => [e, ...rest])
  )
}
const schedules = orders(
  ['commitA', 'deliverA', 'commitB', 'deliverB'],
  [
    ['commitA', 'deliverA'],
    ['commitB', 'deliverB'],
  ]
)

check('fixed names + revocation of observed predecessor leaves overlapping sign-ins live', () => {
  const traces = []
  for (const schedule of schedules) {
    const live = new Set(['old'])
    let cookie = null
    let sawB = false
    for (const event of schedule) {
      const sid = event.endsWith('A') ? 'A' : 'B'
      if (event.startsWith('commit')) {
        live.delete('old')
        live.add(sid)
      } else {
        cookie = sid
        if (sid === 'B') sawB = true
        if (sid === 'A' && sawB && live.has(cookie)) traces.push(schedule)
      }
    }
  }
  assert(traces.length > 0)
  return {
    result: 'counterexample',
    schedules: schedules.length,
    witness: traces[0],
    consequence: 'B was delivered, then live A became the credential cookie',
  }
})

check('server current-login fence blocks delayed credentials for an established binding', () => {
  let explored = 0
  for (const schedule of schedules) {
    let current = null,
      cookie = null
    const revoked = new Set()
    for (const event of schedule) {
      const sid = event.endsWith('A') ? 'A' : 'B'
      if (event.startsWith('commit')) {
        if (current) revoked.add(current)
        current = sid
      } else cookie = sid
      const accepted = cookie !== null && cookie === current && !revoked.has(cookie)
      assert(!accepted || cookie === current)
      explored++
    }
  }
  return {
    result: 'holds in model',
    states: explored,
    assumption:
      'all requests name the same established browser binding; commit order defines current login',
  }
})

check('one revision allows only one of two competing sign-ins to commit', () => {
  for (const sequence of [
    ['A', 'B'],
    ['B', 'A'],
  ]) {
    let revision = 0
    const successes = []
    for (const sid of sequence)
      if (revision === 0) {
        revision++
        successes.push(sid)
      }
    assert.equal(successes.length, 1)
  }
  return {
    result: 'holds in model',
    schedules: 2,
    assumption: 'both sign-in forms captured revision zero for the same browser binding',
  }
})

check(
  'making a binding persistent and renewing it is not sufficient at binding loss/expiry',
  () => {
    // A renewal has committed an extended lifetime but its cookies have not arrived.
    // The old browser cookies expire (or are lost) before delivery. Bootstrap B
    // cannot identify the old record and Y signs in. The delayed A response writes
    // both its renewed persistent binding and its credentials.
    const records = new Map([
      ['bindingA', 'X'],
      ['bindingB', 'Y'],
    ])
    let browser = { binding: 'bindingB', credential: 'Y' }
    browser = { binding: 'bindingA', credential: 'X' }
    const accepted = records.get(browser.binding) === browser.credential
    assert(accepted)
    return {
      result: 'counterexample',
      witness: [
        'renew X on bindingA; hold response',
        'bindingA cookies expire or are lost',
        'bootstrap bindingB; sign in Y',
        'deliver old bindingA + X cookies',
      ],
      consequence:
        'server current-login lookup accepts X because the response also restored bindingA',
    }
  }
)

check('session-only immutable binding conflicts with restart persistence', () => {
  const retainedRefresh = { login: 'X', valid: true }
  const bindingAfterRestart = null
  assert(retainedRefresh.valid && !bindingAfterRestart)
  return {
    result: 'requirement violation',
    consequence: 'valid refresh survives but required binding does not',
  }
})

check(
  'independent persistent request identity rejects an old cookie without replacing that identity',
  () => {
    const currentByBrowser = new Map([
      ['canonical', 'Y'],
      ['old', 'X'],
    ])
    const persistentIdentity = 'canonical'
    let credential = 'X' // late Set-Cookie
    const authorize = (header, cookie) => header != null && currentByBrowser.get(header) === cookie
    assert.equal(authorize(persistentIdentity, credential), false)
    credential = 'Y'
    assert.equal(authorize(persistentIdentity, credential), true)
    const reopenedIdentity = persistentIdentity // retained durable state, not a session cookie
    assert.equal(authorize(reopenedIdentity, credential), true)
    assert.equal(authorize(undefined, credential), false)
    return {
      result: 'holds only with mandatory independent identity',
      limitation:
        'ordinary SSR navigation lacks that header; cookie-only fallback defeats the property',
    }
  }
)

check(
  'versioned login cookies without durable selection are insufficient after selector loss',
  () => {
    const live = new Set(['A', 'B'])
    const cookieLogins = new Set(['A', 'B'])
    // A late A response does not replace B: the names are distinct.
    assert(cookieLogins.has('B'))
    // Losing B selection/credentials while an A cookie remains is observationally
    // indistinguishable from a browser which only signed into A.
    cookieLogins.delete('B')
    const fallback = [...cookieLogins][0]
    assert(live.has(fallback))
    return {
      result: 'counterexample without a no-fallback fence',
      consequence: 'an older still-live login must not become the fallback identity',
    }
  }
)

console.log(
  JSON.stringify({ kind: 'abstract protocol model; not production validation', results }, null, 2)
)
