# @byline/analytics-postgres

The PostgreSQL `AnalyticsStore` for `@byline/analytics`. It reuses the host
application's existing `pg.Pool` and owns its raw-event, salt, aggregate, and
rollup-state tables.

## Schema and migrations

The driver follows `@byline/search-postgres`: numbered SQL files under
`migrations/` are the DBA-reviewable source of truth, an embedded byte-matched
copy makes `migrate()` safe inside Nitro/Rollup server bundles, and
`byline_analytics_migrations` records applied versions independently of the
application's Drizzle stream.

```ts
import { migrate, postgresAnalyticsStore } from '@byline/analytics-postgres'

await migrate(db.pool)
const store = postgresAnalyticsStore({ pool: db.pool })
```

Production deployments should run `migrate()` as a deliberate release step.
`autoMigrate: true` is available for local development.
