---
title: "Getting Started - Experimental CLI"
path: "getting-started-cli"
summary: "The experimental Byline CLI: 'byline init' against an existing TanStack Start app, plus 'setup' and 'doctor' for adding Byline to a fresh project."
---

Note: We have an experimental CLI that will attempt to install Byline into an existing TanStack Start application. This has only been tested against up-to-date TanStack Start sites created with the Nitro (agnostic adapter). You can install TanStack Start with:

```sh
npx @tanstack/cli@latest create

#or

pnpm dlx @tanstack/cli@latest create
```
Then be sure to select the Nitro (agnostic) adapter.
```
◆  Select deployment adapter:
│  ○ None
│  ○ Cloudflare
│  ○ Netlify
│  ● Nitro (agnostic)
│  ○ Railway
└
```
Once your TanStack Start application is ready you can initialize a Byline installation with:

```sh
npx @byline/cli@latest init

# or

pnpm dlx @byline/cli@latest init
```
NOTE: If you use `pnpm` - installing dependencies may bail out asking you to `pnpm approve-builds`
You can stop the `cli@latest init` - approve builds, and then re-run `pnpm dlx @byline/cli@latest init` and
it will pick up where it left off. You may need to do this more than once.

At a minimum - for `pnpm >= 11` - you'll need a `pnpm-workspace.yaml` file in the root of your project that looks something like this:

```
minimumReleaseAge: 1440
allowBuilds:
  "@google/genai": true
  "@parcel/watcher": true
  protobufjs: true
  sharp: true

```

If there are any issues, you can follow the example application in the Byline CMS main repo under `apps/webapp`.

NOTE: For AI-assisted editing, you'll need to add your API keys as shown in `apps/webapp/.env.local.example`

IMPORTANT: The core Byline routes will be placed under a pathless route at `routes/_byline`, with its own route.tsx template. To prevent your front-end TanStack Start application's styling from 'leaking' into the Byline dashboard, you'll need to create or move your top-most layout route into its own pathless layout route - for example, under `routes/_fontend` or `routes/_public` - with any styling, headers, footers etc., that might have been in __root.tsx - moved into the route.tsx layout file inside your frontend pathless layout route.

See the TanStack Router docs for [File-Based Routing](https://tanstack.com/router/latest/docs/routing/file-based-routing) and [Virtual File Routes](https://tanstack.com/router/latest/docs/routing/virtual-file-routes) for more information.

NOTE: If you have manually configured Byline by copying code from the example application in the repo (byline directories, .env, start, server, __root.tsx, and vite.config.ts settings), and only want to provision the database and seed the super-admin and example docs in the new application, use `byline setup` instead of `byline init`:

```sh
npx @byline/cli@latest setup

# or

pnpm dlx @byline/cli@latest setup
```

`setup` runs only the database-provisioning and seed phases (`db` → `db-init` → `seed-admin` → `seed-docs`) — it does not touch project files. Useful flag examples:

```sh
# Provision the DB and seed both the super-admin and example docs (default)
byline setup

# Provision the DB and seed the super-admin only
byline setup --no-seed-docs

# Provision the DB and seed example docs only
byline setup --no-seed-admin

# Provision the DB without running either seed
byline setup --no-seed-admin --no-seed-docs

# Destructive: drop and recreate the database (requires both flags)
byline setup --reset --i-mean-it

# Re-run every phase even if recorded as complete (non-destructive on its own —
# migrations re-apply as no-ops, seeds are idempotent)
byline setup --force

# Full nuke-and-pave: drop and recreate the database, then re-run every phase
byline setup --force --reset --i-mean-it
```

By default `setup` consults `.byline-install.json` and skips phases already recorded as complete. `--force` bypasses that and re-runs each phase against fresh state — useful after a manual DB reset, when you want to re-seed, or to re-verify a setup is healthy. A confirmation prompt fires before either of the `--force` flows runs (skippable with `-y`); the destructive `--reset` flow has its own confirm inside `db-init` unless `--i-mean-it` is also passed.

Before running any phase, `setup` performs a quick pre-flight: it bails if the core `@byline/*` packages aren't installed in your app's `package.json`, bails if `.env` or `.env.local` is missing, and warns-and-confirms if `.env` or `.env.local` is present but missing keys Byline expects (some keys may legitimately be supplied via shell env). For new TanStack Start apps that need the full scaffold, use `byline init` instead.
