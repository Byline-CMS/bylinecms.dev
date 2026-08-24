# @byline/analytics

The portable, server-side contract for Byline's first-party web analytics.
This package owns ingest validation, privacy-preserving daily visitor hashes,
query contracts, rollup orchestration, retention policy, and the
`analytics.rollup` recurring-task definition. It contains no SQL dialect and
does not read framework request objects or forwarding headers.

Pair it with `@byline/analytics-postgres` or `@byline/analytics-mysql`. The
driver supplies an `AnalyticsStore` using the application's existing database
pool:

```ts
const analytics = createAnalytics({
  store: postgresAnalyticsStore({ pool: db.pool }),
  publicDomains: ['www.example.com'],
})

defineServerConfig({
  db,
  recurringTasks: [defineAnalyticsRollupTask({ analytics })],
})
```

The host request bridge must provide the normalized client IP and trusted
country metadata directly to `analytics.ingest()`. Never derive them in this
package from arbitrary forwarding headers. The raw IP is used only to compute
the daily HMAC and is absent from every store and logging type.

Global Privacy Control is a do-not-sell-or-share signal, not a general
first-party processing opt-out. Byline analytics does not sell, share, or use
events for cross-context advertising, so this package neither accepts nor
stores GPC state. The browser's explicit Byline analytics opt-out remains the
appropriate control.

`createAnalyticsPrivacyStatement()` produces editable plain-text copy for the
installation's privacy page. Supply the operator name, the public instructions
for the browser-local exclusion control, and any finite path or referrer
aggregate retention. The returned `operatorNotice` is not public copy: it
reminds the deployment owner that the template requires review and is not legal
advice.
