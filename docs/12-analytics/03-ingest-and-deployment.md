---
title: "Analytics ingest and deployment"
path: "ingest-and-deployment"
summary: "How an application mounts analytics ingest and supplies trusted request facts with no required proxy topology."
---

# Analytics ingest and deployment

Companions:
- [Analytics](./index.md) — the portable contract and end-to-end flow.
- [Analytics browser agent and consent](./02-browser-agent-and-consent.md) — choosing the endpoint and loading policy.
- [Deployment topologies](../03-architecture/05-deployment-topologies.md) — Byline's integrated and future split-host arrangements.
- [Routing and API](../05-reading-and-delivery/02-routing-and-api.md) — why document and upload operations still use host transports rather than a stable public HTTP API.

The browser agent needs one anonymous POST endpoint. The application chooses its path and connects it to `analytics.ingest()`. Neither the portable package nor the TanStack host mounts that route automatically.

This write-only telemetry endpoint does not introduce a stable Byline document or upload API. It accepts one fixed event shape, returns an empty response, and exposes no content operations.

## TanStack route entry point

A TanStack application can create a thin route at its chosen path and use `createAnalyticsEventHandler()`:

The reference application places the route here:

```text
apps/webapp/
└── src/
    └── routes/
        └── telemetry/
            └── events.ts
```

Edit `apps/webapp/src/routes/telemetry/events.ts`. The smallest host-neutral
shape is:

```ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/telemetry/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { createAnalyticsEventHandler } = await import(
          '@byline/host-tanstack-start/integrations/analytics-events'
        )

        return createAnalyticsEventHandler({
          resolveRequestContext: async (request) => ({
            clientIp: await resolveClientAddressFromThisHost(request),
            country: await resolveCountryFromThisHost(request),
          }),
        })(request)
      },
    },
  },
})
```

The two resolver functions represent application or platform code; Byline does not provide universal implementations. A Fetch `Request` does not consistently expose the underlying socket, and hosting platforms expose connection metadata through different APIs.

The handler bounds the body, extracts ordinary browser headers, and passes only the resolver's `clientIp` and `country` values to the portable runtime. It never inspects `X-Forwarded-For` on its own.

## Scenario 1: direct or platform-hosted application

A deployment without nginx or Cloudflare resolves the connecting address using its trusted server runtime or hosting-platform request context. The host integration may close over framework request state or adapt platform metadata before invoking the analytics handler.

Do not replace that platform integration with an arbitrary forwarding header merely because a header is present. A value supplied directly by the browser is not a network identity.

If the host cannot obtain a request-scoped client identity, the standard analytics runtime silently drops the event with reason `client-ip`. Current daily-visitor semantics require an identity seed; the package does not pretend that page views can produce accurate unique visitors without one.

## Scenario 2: nginx or another trusted reverse proxy

An origin proxy can normalize its verified connection facts into application-owned headers. `trustedAnalyticsHeaders()` is an optional resolver for this deployment:

In `apps/webapp/src/routes/telemetry/events.ts`, use this resolver as the
`resolveRequestContext` passed to `createAnalyticsEventHandler()`:

```ts
import {
  createAnalyticsEventHandler,
  trustedAnalyticsHeaders,
} from '@byline/host-tanstack-start/integrations/analytics-events'

const handleEvent = createAnalyticsEventHandler({
  resolveRequestContext: trustedAnalyticsHeaders({
    clientIpHeader: 'x-byline-client-ip',
    countryHeader: 'x-byline-client-country',
  }),
})
```

The helper validates names and reads values; it does not establish trust. nginx must overwrite the headers, and Node must accept requests only through that trusted boundary.

An illustrative nginx location for an application that selected `/telemetry/events` is:

Edit the deployment-owned nginx configuration, such as
`deploy/nginx/byline.conf` in source control or
`/etc/nginx/conf.d/byline.conf` on the host. Place `limit_req_zone` in the
`http` context and the `location` inside the Byline origin's `server` block:

```nginx
limit_req_zone $binary_remote_addr zone=byline_analytics:10m rate=5r/s;

location = /telemetry/events {
    client_max_body_size 1k;
    limit_req zone=byline_analytics burst=10 nodelay;
    limit_req_status 429;
    proxy_set_header X-Byline-Client-IP $remote_addr;
    proxy_set_header X-Byline-Client-Country $byline_client_country;
    proxy_pass http://byline_node;
}
```

`$byline_client_country` is deployment-specific and may be empty. Country is optional.

When nginx is directly internet-facing, `$remote_addr` is the connecting client. When another proxy is in front, nginx must trust that proxy's address metadata only for known upstream networks and then normalize the verified result into `$remote_addr`.

## Scenario 3: Cloudflare in front of nginx

Cloudflare is optional. In a deployment that uses it, nginx can accept `CF-Connecting-IP` only from current Cloudflare proxy ranges, using `set_real_ip_from` and `real_ip_header CF-Connecting-IP`. It can then place the normalized `$remote_addr` into `X-Byline-Client-IP`.

The origin must prevent direct access that bypasses this trust rule. Cloudflare can also apply an outer per-client rate limit and attach country metadata. POST requests to the selected endpoint must bypass any HTML cache rule.

These are deployment instructions for that topology, not requirements of `@byline/analytics-agent` or `@byline/analytics`.

## Scenario 4: local development and built-app testing

A local Vite request has no production proxy or platform identity. The same is true when a production build runs directly on localhost through `pnpm preview` or a Nitro `pnpm start` command.

`localAnalyticsRequestContext()` accepts the direct address only when both the request URL and the runtime-resolved peer are loopback. Combining it with `trustedAnalyticsHeaders()` keeps the production proxy path authoritative while allowing the same route to work through Vite development, Vite preview, and direct Nitro start:

In `apps/webapp/src/routes/telemetry/events.ts`, replace the simpler trusted
header resolver above with this composed resolver:

```ts
import { getRequestIP } from '@tanstack/react-start/server'

resolveRequestContext: trustedAnalyticsHeaders({
  clientIpHeader: 'x-byline-client-ip',
  countryHeader: 'x-byline-client-country',
  fallback: localAnalyticsRequestContext({
    resolveClientIp: () => getRequestIP(),
    developmentFallbackClientIp: import.meta.env.DEV
      ? 'vite-development'
      : undefined,
  }),
})
```

`getRequestIP()` is called without forwarded-header support: it represents the direct peer known to TanStack Start and Nitro. The local resolver rejects a public hostname, a non-loopback peer, and arbitrary forwarding headers. This means the compiled route can retain loopback support without enabling a fixed production identity.

Never configure a fixed production identity. It would collapse clients with the same user agent into one daily visitor. The production bundle compiles the explicit Vite development fallback away; only the verified loopback path remains for `preview` and `start`.

Vite preview serves a production build but normally loads the production-mode environment. If that environment configures a public production hostname, a browser visiting `localhost` is correctly rejected by the origin policy. A local preview script can select development-mode environment loading without changing the built artifacts:

Edit the `scripts` object in `apps/webapp/package.json`:

```json
{
  "scripts": {
    "preview": "vite preview --mode development --port 5173"
  }
}
```

For direct Nitro start, load the local runtime environment that supplies the localhost public URL, database connection, and other server settings. A deployed Nitro process instead supplies the real production hostname and trusted-proxy configuration through its deployment environment.

## Ingest policy and responses

The analytics integration obtains values from three different sources. Keeping
them separate is important because the browser payload is not trusted network
metadata:

| Values | Source | Purpose |
|---|---|---|
| `v`, `kind`, `path`, `ref` | The agent's `text/plain` JSON body. | Event version, type, location, and referrer candidate. |
| `Origin` or request `Referer`, `User-Agent`, `Sec-Purpose`, `X-Purpose` | Ordinary HTTP request headers read by the host handler. | Origin filtering, daily identity input, and bot or prefetch filtering. |
| `clientIp`, optional `country` | The application-owned request-context resolver. | Daily identity input and optional country dimension. |
| `occurredAt` | The application server clock when ingest begins. | Authoritative event timestamp and UTC day. |

The body field `ref` and the HTTP `Referer` header have different jobs. `ref`
can become the stored external referrer host. The `Origin` header, with the
request `Referer` only as a fallback, selects the host checked against
`publicDomains`.

The handler and portable runtime then apply this sequence:

1. The host streams at most 1,024 bytes and decodes valid UTF-8. The JSON object
   must contain exactly `v`, `kind`, `path`, and `ref`; `v` must be `1`, `kind`
   must be `page` or `download`, and both remaining values must be strings.
   Unknown or missing fields are rejected.
2. The request must use POST. The host from `Origin`, or the request `Referer`
   fallback, is lowercased, stripped of a trailing dot, and matched—including
   any development port—against `publicDomains`.
3. `path` must begin with `/` and contain no unpaired UTF-16 surrogate. The
   runtime removes everything from the first `?` or `#`, collapses repeated
   slashes, and keeps at most 512 Unicode code points. It then silently drops
   exact configured internal paths and their descendants.
4. A blank user agent or one matched by the pinned `isbot` implementation is
   silently dropped. `Sec-Purpose: prefetch` and `X-Purpose: preview` are also
   silently dropped.
5. The host-resolved `clientIp` must be non-empty. The portable runtime does not
   read forwarding headers itself and does not continue without this identity
   input.
6. The runtime obtains the current UTC day's 32-byte salt and computes
   `HMAC-SHA-256(salt, length-prefixed(clientIp, userAgent))`. Neither raw input
   is passed to the storage adapter.
7. An in-process cache suppresses the same `(visitor hash, kind, normalized
   path)` for ten seconds. The default cache holds at most 10,000 keys. It is
   intentionally not shared across application instances.
8. The payload referrer is reduced to a lowercase host of at most 255 Unicode
   code points. Empty, invalid, same-installation, and reserved `__other__`
   values become `null`. A trusted country becomes an uppercase two-letter
   code; any other value becomes `null`.
9. The adapter inserts the server timestamp, kind, source `beacon`, normalized
   path, visitor hash, normalized referrer host, and optional country. A failed
   insert removes the provisional replay key so a later independent event is
   not poisoned by the failure.

The analytics handler does not read request cookies. The runtime processes but
does not persist the complete referrer URL, user agent, raw client address, or
request origin; it accepts no client timestamp. A same-origin browser may still
attach cookies at the HTTP layer, but the analytics handler ignores them.

Responses contain no body and no CORS headers:

| Status | Meaning |
|---|---|
| `202` | The event was accepted and stored. |
| `204` | Policy silently dropped the event, including origin, path, bot, prefetch, missing identity, or replay. |
| `400` | The method, size, or payload was invalid. |
| `429` | An optional platform or proxy rate limiter rejected the request before the application. |
| `503` | Event persistence failed. The browser does not retry. |

Every application response carries `Cache-Control: no-store`.

The lack of CORS response headers prevents another origin from reading the response, but it does not prevent a simple `text/plain` cross-origin POST. The origin validation is the application-level filter, and it remains abuse resistance rather than authentication because a non-browser client can forge browser headers.

A persistence failure is not recorded as a policy drop. The handler logs only a
fixed message and an allowlisted database error code, returns `503` with an
empty body, and never attaches the request, payload, visitor hash, or database
error object to the log entry.
