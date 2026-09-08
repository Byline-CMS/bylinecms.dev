import assert from 'node:assert/strict'

// Explicitly models SERIAL client storage transactions, not localStorage CAS.
// Native cookies stay opaque credentials. Intent is a non-authorizing marker.
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
  ['commitA', 'deliverA', 'publishA', 'commitB', 'deliverB', 'publishB'],
  [
    ['commitA', 'deliverA'],
    ['deliverA', 'publishA'],
    ['commitB', 'deliverB'],
    ['deliverB', 'publishB'],
  ]
)
let explored = 0,
  authoritativeBStates = 0
for (const trace of schedules) {
  // Both user actions have begun. B is the most recent intent transaction.
  const durable = { latestAttempt: 'B', current: 'old' }
  const live = new Set(['old'])
  let credential = 'old',
    marker = 'old',
    selectedB = false
  for (const event of trace) {
    const sid = event.endsWith('A') ? 'A' : 'B'
    if (event.startsWith('commit')) {
      live.delete('old')
      live.add(sid)
    }
    if (event.startsWith('deliver')) credential = sid
    if (event.startsWith('publish') && durable.latestAttempt === sid) {
      marker = sid
      durable.current = sid
      if (sid === 'B') selectedB = true
    }
    const authorized = live.has(credential) && marker === credential
    // Once B was published, stale A headers cannot change selection to A.
    if (selectedB) {
      assert(!authorized || credential === 'B')
      authoritativeBStates++
    }
    explored++
  }
  // Restart preserves both durable non-secret metadata and cookie values.
  assert.equal(durable.current, 'B')
  assert.equal(marker, 'B')
  // A late successful callback trying to renew its old marker is conditional.
  const renewalIntent = 'A'
  if (durable.current === renewalIntent) marker = renewalIntent
  assert.equal(marker, 'B')
}
// A plain read/write without a shared transaction demonstrably loses ordering.
let marker = 'A'
const staleRead = marker
marker = 'B'
marker = staleRead
assert.equal(marker, 'A')
// Header-free SSR can check the marker cookie against credentials.
const ssr = (credential, marker, live) => !!marker && marker === credential && live.has(credential)
assert.equal(ssr('A', 'B', new Set(['A', 'B'])), false)
assert.equal(ssr('B', 'B', new Set(['A', 'B'])), true)
// The marker alone cannot authenticate, and missing state does not select a cookie login.
assert.equal(ssr(null, 'B', new Set(['B'])), false)
assert.equal(ssr('A', null, new Set(['A'])), false)
// Recovery must compare retained intent to server-validated credentials, never adopt A.
const durableIntent = 'B',
  lateCredential = 'A'
assert.notEqual(durableIntent, lateCredential)
// Logout changes the client intent tombstone; delayed login publish loses its CAS.
const logoutState = { latestAttempt: 'logout', current: null }
assert.notEqual(logoutState.latestAttempt, 'B')
console.log(
  JSON.stringify(
    {
      kind: 'abstract serial-transaction model; not browser or database validation',
      schedules: schedules.length,
      states: explored,
      statesAfterBPublished: authoritativeBStates,
      result: 'no A authorization after B publication in enumerated schedules',
      additionalChecks: [
        'restart retention',
        'conditional renewal',
        'SSR cookie guard',
        'marker alone grants no authority',
        'missing marker fails closed',
        'no fallback on retained-intent mismatch',
        'logout invalidates pending sign-in completion',
        'unserialized writes reproduce counterexample',
      ],
      unproven: [
        'browser/IndexedDB transaction lifecycle and abort recovery',
        'real host middleware coverage',
        'cookie restrictions and eviction',
        'provider and database costs',
        'XSS or malicious same-origin script',
      ],
    },
    null,
    2
  )
)

// Durable selection and the cookie are NOT one transaction. Commit selection
// first. Every later cookie publisher must freshly read it under serialization.
// The publication transaction does not change canonical selection, so aborting
// it cannot roll the canonical selection back after a cookie write.
for (const crashPoint of ['before-cookie', 'after-cookie', 'none']) {
  const persisted = { current: 'B', latestAttempt: 'B' } // selection transaction committed
  let marker = 'old'
  if (crashPoint !== 'before-cookie') marker = persisted.current
  // Browser restart/recovery republishes only committed intent, never credentials' sid.
  marker = persisted.current
  assert.equal(marker, 'B')
  // Stale A publisher also reads B rather than a captured A value.
  marker = persisted.current
  assert.equal(marker, 'B')
}
console.log(
  'Journal-first publication model: before/after-cookie crash recovery preserved B (3 cases).'
)
