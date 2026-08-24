# @byline/analytics-agent

The dependency-free browser collector for `@byline/analytics`. It sends one
cookieless first-party page event on load, accepts committed SPA navigation
locations from a host adapter, and observes download clicks without delaying
navigation. The package mounts no route and injects no script by itself.

Install the package, place its minified `dist/b.js` artifact in the static
directory served by the application, and load it with ordinary HTML:

```sh
npm install @byline/analytics-agent
cp node_modules/@byline/analytics-agent/dist/b.js public/b.js
```

```html
<script
  defer
  src="/b.js"
  data-endpoint="/telemetry/events"
  data-ignore-prefixes="/admin,/_byline"
></script>
```

`data-endpoint` is required and must be a same-origin, root-relative path. The
package needs no framework, route helper, or build integration.

The application's static host owns the script's MIME, cache, and security
headers. It must serve the file as JavaScript; a stable filename should use a
bounded cache lifetime with revalidation. Host integrations may offer a
dynamic-response helper when the application wants those headers supplied in
code instead.

The published package also exports the standalone artifact as
`@byline/analytics-agent/standalone.js`, a programmatic browser API, and a
bundle-safe source string:

```ts
import { ANALYTICS_AGENT_SOURCE } from '@byline/analytics-agent/source'
```

An application chooses its public filename and ingest route. Host adapters can
provide optional delivery and component helpers, but those helpers do not make
their paths part of the analytics package contract.

Applications that bundle the browser API can install and stop it directly:

```ts
import { installAnalyticsAgent } from '@byline/analytics-agent'

const agent = installAnalyticsAgent({ endpoint: '/telemetry/events' })
agent.stop()
```

The agent never writes client storage. It only reads
`localStorage["byline-analytics-ignore"]`, the explicit per-browser opt-out. It
does not inspect or transmit Global Privacy Control: Byline analytics neither
sells nor shares the installation's data, and GPC is not a general first-party
processing opt-out.

Host adapters must feed only committed/resolved navigations by dispatching
`byline:analytics:navigate` with the resolved location string as the custom
event detail. Preloads and hover activity must never dispatch that event.
Consent owners can stop the standalone collector by dispatching
`byline:analytics:stop`; the TanStack `AnalyticsAgent` helper does this when it
unmounts.
