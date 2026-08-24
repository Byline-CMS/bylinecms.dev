# @byline/analytics-mysql

The MySQL `AnalyticsStore` for `@byline/analytics`. It reuses the host
application's existing mysql2 pool and owns its raw-event, salt, aggregate,
and rollup-state tables.

The driver follows `@byline/search-mysql`: numbered SQL files under
`migrations/` remain DBA-reviewable, a byte-matched embedded copy keeps
`migrate()` bundle-safe, and an advisory lock serializes migration runners
because MySQL DDL auto-commits.

```ts
import { migrate, mysqlAnalyticsStore } from '@byline/analytics-mysql'

await migrate(db.pool)
const store = mysqlAnalyticsStore({ pool: db.pool })
```

Analytics serializes timestamps explicitly as UTC, so day attribution does not
depend on mysql2's pool `timezone` option or the Node.js process timezone.
Production deployments should run `migrate()` deliberately. `autoMigrate:
true` is a development convenience.
