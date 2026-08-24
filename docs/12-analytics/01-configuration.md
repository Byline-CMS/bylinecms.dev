---
title: "Analytics configuration"
path: "analytics-configuration"
summary: "How to select an analytics database adapter, run its migrations, register the portable runtime, and schedule maintenance."
---

# Analytics configuration

Companions:
- [Analytics](./index.md) — package responsibilities and the end-to-end model.
- [Browser agent and consent](./02-browser-agent-and-consent.md) — browser installation choices and the required endpoint setting.
- [Ingest and deployment](./03-ingest-and-deployment.md) — connecting the application-owned route to request facts.
- [Recurring tasks](../11-scheduling/01-recurring-tasks.md) — starting the in-process ticker or invoking tasks from external cron.

An installation combines the portable `@byline/analytics` runtime with one SQL adapter. The application owns construction and registration so it can share an existing database pool and can fail startup if analytics migrations do not succeed.

## Create and register the runtime

The reference application constructs analytics beside the rest of its
server-only runtime in `apps/webapp/byline/server.config.ts`:

```text
apps/webapp/
└── byline/
    └── server.config.ts
```

Edit that file, or the equivalent server bootstrap in another application. A
PostgreSQL setup has this shape:

```ts
import {
  createAnalytics,
  defineAnalyticsRollupTask,
  registerAnalytics,
} from '@byline/analytics'
import {
  migrate as migrateAnalytics,
  postgresAnalyticsStore,
} from '@byline/analytics-postgres'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
await migrateAnalytics(pool)

const analytics = registerAnalytics(
  createAnalytics({
    store: postgresAnalyticsStore({ pool }),
    publicDomains: ['www.example.com'],
    ignoredPathPrefixes: ['/admin', '/internal'],
  })
)

const serverConfig = {
  recurringTasks: [defineAnalyticsRollupTask({ analytics })],
}
```

Use `mysqlAnalyticsStore()` and the MySQL package's `migrate()` function in the
same server bootstrap when the application uses MySQL. Both stores implement
the same `AnalyticsStore` contract.

`registerAnalytics()` publishes the installation runtime to optional host integrations such as the TanStack ingest bridge and authenticated admin queries. It does not mount routes or start maintenance.

## Public domains and ignored paths

`publicDomains` is required. An event's `Origin`, or its `Referer` fallback, must match one of these hosts. Include a development port when the browser uses one:

In `apps/webapp/byline/server.config.ts`, set the option inside the
`createAnalytics()` call:

```ts
publicDomains: ['www.example.com', 'localhost:5173']
```

This check rejects accidental cross-site submissions but does not authenticate an event. A non-browser client can forge an `Origin` header.

`ignoredPathPrefixes` provides a second server-side guard for admin and internal pages. The browser agent also accepts ignored prefixes, but a modified script can bypass a browser-only check.

## Database migrations

Each adapter owns an independent numbered migration stream under its package `migrations` directory. The migration ledger is `byline_analytics_migrations`, and physical analytics tables use the `byline_analytics_` prefix.

The runner discovers the SQL files bundled with the selected package, applies each file transactionally, and serializes concurrent startup. This stream is separate from Byline's core Drizzle migrations, like the search-provider migration streams.

A configured analytics runtime without its schema is an invalid partial startup. Run and await analytics migrations before registering the runtime or exposing its host integration.

## Maintenance registration

`defineAnalyticsRollupTask({ analytics })` creates an inert recurring-task definition. Registering it does not start a timer. The application must also run `startBylineScheduler()` or invoke due tasks from its external scheduling path.

The default task runs hourly. It rolls up completed UTC days, catches up a bounded number of days per invocation, flushes idle-day metrics, and applies retention after it converges. [Storage, rollups, and operations](./04-storage-rollups-and-operations.md) describes those effects.

## Host integration remains explicit

After constructing the runtime, the application separately decides:

- Where the standalone JavaScript file is served, if it uses that artifact.
- Which layout or consent boundary loads the agent.
- Which same-origin URL accepts events.
- How the host resolves request-scoped client identity and country.
- Whether the authenticated Byline admin dashboard is mounted.

The analytics packages deliberately do not derive any of these choices from the Byline admin or future API route prefixes.
