---
title: "Analytics browser agent and consent"
path: "analytics/browser-agent-and-consent"
summary: "How an application serves or bundles the analytics collector, selects its ingest endpoint, reports SPA navigations, and controls consent."
---

# Analytics browser agent and consent

Companions:
- [Analytics](./index.md) — package boundaries and standard data behavior.
- [Analytics configuration](./01-configuration.md) — server runtime and adapter registration.
- [Ingest and deployment](./03-ingest-and-deployment.md) — implementing the endpoint selected here.
- [Caching](../05-reading-and-delivery/06-caching.md) — application and edge caching responsibilities.

`@byline/analytics-agent` is a dependency-free browser library. Its simplest installation is the same on any stack: install the package, place its standalone file in the application's static assets, and load it with a script tag. No React, TanStack, Vite plugin, or server route is required.

Every installation supplies an application-owned, same-origin endpoint. The path must begin with `/`, must not begin with `//`, and must not contain a fragment. There is no package-wide `/api` convention.

## Install the standalone script

Install the package and copy the published browser artifact to the directory the application already serves as static files:

Run these commands from the application package root. In the reference
application that is `apps/webapp`, and the destination is
`apps/webapp/public/b.js`:

```sh
npm install @byline/analytics-agent
cp node_modules/@byline/analytics-agent/dist/b.js public/b.js
```

Then edit the HTML document template that owns the public page. This
framework-neutral example uses `src/document.html` and expresses options as
bounded `data-*` attributes:

```html
<script
  defer
  src="/b.js"
  data-endpoint="/telemetry/events"
  data-cdn-hosts="cdn.example.com"
  data-ignore-prefixes="/admin,/api,/_byline,/telemetry"
></script>
```

The public filename is the application's choice. The script URL may use an asset host, but `data-endpoint` remains relative to the page origin, not the script origin. The package also exposes the same file through its `@byline/analytics-agent/standalone.js` export for build tools that resolve package assets.

Byline's reference webapp commits `public/b.js` so its setup demonstrates this ordinary static-file pattern. A unit test compares that file with `ANALYTICS_AGENT_SOURCE`; upgrading the package fails the test until the checked-in artifact is refreshed.

Static-file response policy belongs to the application's host. In the reference webapp with Vite 8.2.2, a browser-shaped `Sec-Fetch-Dest: script` request receives `200` and `text/javascript` in development and preview. Development adds `Cache-Control: no-cache`; preview adds no `Cache-Control`. Direct Nitro start returns `200` and `text/javascript; charset=utf-8` with validators but no `Cache-Control`. None of these three public-file responses adds `X-Content-Type-Options`; a deployment may add `nosniff` as a general security header at its direct server or proxy.

When the public filename is content-versioned, it can use immutable caching. When the application uses a stable filename, configure a bounded lifetime and mandatory revalidation at the static host or proxy so fixes reach returning browsers. Do not assume that copying the file also selects those headers.

## Alternative: serve the source dynamically

A host that prefers not to copy the artifact can serve the exact standalone build through an application-owned route. A TanStack Start route can use the host convenience:

Create this route file. TanStack's `[.]` filename escape makes the public route
literal `/b.js` rather than a route parameter:

```text
apps/webapp/
└── src/
    └── routes/
        └── b[.]js.ts
```

Add the following code to `apps/webapp/src/routes/b[.]js.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/b.js')({
  server: {
    handlers: {
      GET: async () => {
        const { serveAnalyticsAgent } = await import(
          '@byline/host-tanstack-start/integrations/serve-analytics-agent'
        )
        return serveAnalyticsAgent()
      },
    },
  },
})
```

Other hosts can return `ANALYTICS_AGENT_SOURCE` from `@byline/analytics-agent/source` with their chosen response API. `serveAnalyticsAgent()` adds `text/javascript`, bounded mandatory-revalidation caching, and `X-Content-Type-Options: nosniff`; the application still owns and mounts the route.

A browser script request carries `Sec-Fetch-Dest: script`. In development, Vite uses that header to send the request into its module transform pipeline before a TanStack Start `.js` route can answer. A route-based application can respond earlier by placing `bylineAnalyticsDev({ agentPath })` before `tanstackStart()`:

Edit the route-based application's `apps/webapp/vite.config.ts` plugin list:

```ts
import { bylineAnalyticsDev } from '@byline/host-tanstack-start/vite'

plugins: [bylineAnalyticsDev({ agentPath: '/b.js' }), tanstackStart()]
```

This plugin is only a Vite-development compatibility helper for the dynamic route pattern. Production Nitro does not use Vite's development middleware. Applications serving the file from Vite's ordinary `public` directory do not need the plugin in any mode.

## Bundle the browser API

An application may bundle the collector rather than load a standalone script:

Create an application-owned browser entry such as `src/analytics.ts`, then
import that file from the application's normal client entry:

```ts
import { installAnalyticsAgent } from '@byline/analytics-agent'

const agent = installAnalyticsAgent({
  endpoint: '/telemetry/events',
  ignoredPathPrefixes: ['/admin', '/internal'],
})

// Stop listeners when the owning integration is disabled or unmounted.
agent.stop()
```

Calling `installAnalyticsAgent()` again while an installation is active returns the existing controller.

## TanStack React helper

The optional TanStack component renders the standalone script and connects committed router locations to it:

In the reference application, edit the public layout at
`apps/webapp/src/routes/$lng/_frontend/route.tsx`:

```tsx
<AnalyticsAgent
  src="/b.js"
  endpoint="/telemetry/events"
  ignoredPathPrefixes={['/admin', '/api', '/_byline', '/telemetry']}
/>
```

`src` defaults to `/b.js` as a host-helper convenience; `endpoint` is always explicit. The component dispatches navigation events only after the router commits a new location. When it unmounts, it sends the agent's stop signal so a consent owner can revoke collection without relying on removal of an already executed script element.

## Browser behavior

On installation, the agent reports one page event. It ignores consecutive navigation identities and ignores query-only and fragment-only changes unless configured to count them. Host adapters must report committed locations only; link hover, preload, prefetch, and failed navigation are not page views.

One delegated document listener reports a download when an anchor targets a configured CDN host or ends in a configured extension. It does not cancel or delay navigation.

The body is `text/plain` JSON with only:

This is the on-wire request body produced by the agent, not a file the
application edits:

```json
{ "v": 1, "kind": "page", "path": "/example", "ref": "https://referrer.example/" }
```

The agent uses `navigator.sendBeacon`, falling back to `fetch` with `keepalive`. It never retries and never reads the response.

## Consent is application-owned

Byline does not decide whether a deployment requires consent. A site owner can load the agent immediately under its chosen legal basis or place the component behind an existing consent system:

In a TanStack application based on the reference layout, place the consent
boundary in `apps/webapp/src/routes/$lng/_frontend/route.tsx` around the same
helper:

```tsx
<Consent category="performance">
  <AnalyticsAgent
    src="/b.js"
    endpoint="/telemetry/events"
    ignoredPathPrefixes={['/admin', '/api', '/_byline', '/telemetry']}
  />
</Consent>
```

When consent is absent, the component is not rendered and the browser does not request the script. When consent is revoked and the component unmounts, the agent removes its navigation, click, and stop listeners.

The initial-page marker is module-scoped and survives a stop. If consent is revoked and granted again during the same page lifetime, reinstalling the script does not recount the page currently on screen. The next committed navigation is the next page event. This avoids turning consent changes or React remounts into duplicate views.

The agent never writes cookies or browser storage. It reads `localStorage["byline-analytics-ignore"]` only for the explicit per-browser exclusion control. That flag is origin-scoped.

Global Privacy Control is not treated as a general first-party analytics signal because the standard subsystem does not sell, share, or use data for cross-context targeted advertising. A deployment that changes those purposes must revisit GPC handling and its privacy notice before shipping.
