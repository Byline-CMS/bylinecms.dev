---
title: "CLI"
path: "getting-started-cli"
summary: "Add Byline to an existing TanStack Start application with 'byline init', provision and seed a hand-wired application with 'byline setup', and check an installation with 'byline doctor'."
---

# CLI

Companions:
- [Getting started](./index.md) — the two routes into a running Byline instance, and where to go next.
- [Development environment and example application](./02-development-environment.md) — clone this repo and run `apps/webapp`, the reference application the installer's scaffold mirrors.
- [Upgrading from 3.21 to 4.x](./03-upgrading-to-v4.md) — the application-side migration guide when you move an existing installation to 4.x.

The Byline CLI (`@byline/cli`) installs Byline into an existing TanStack Start
application. It prompts for installation and configuration options — where to
mount the admin UI, how to connect to PostgreSQL, whether to include the example
collections — and summarises those choices, along with a diff of every file it
plans to write, before installing anything. When it finishes you have a working
admin UI, a provisioned and migrated database, a seeded super-admin account, and
a `byline/` configuration directory ready to edit.

If you are evaluating Byline rather than adding it to a project, the
[development environment](./02-development-environment.md) runs a fully
configured example application without touching your own code.

:::note
The CLI is currently tested against up-to-date TanStack Start sites using the
Nitro (agnostic) adapter.
:::

## Commands

| Command | What it does |
|---|---|
| `byline init` | The full installer. Detects what is already in place, then runs the remaining phases. |
| `byline setup` | Database provisioning and seeding only, for an application you wired by hand. Touches no project files. |
| `byline doctor` | Read-only. Reports which installation phases are complete. |

All three run through your package runner without a global install — for
example `npx @byline/cli@latest init` or `pnpm dlx @byline/cli@latest init`.

## Requirements

- Node `>=20.9.0`.
- A TanStack Start application, ideally under Git. The installer warns and asks
  for confirmation outside a Git repository, because Git is how you roll an
  installation back.
- A running PostgreSQL server and superuser credentials for it. Choose the
  existing-server option when asked; the bundled-Docker option is not yet
  implemented.
- pnpm, npm, Yarn, or Bun.

## Install Byline

### 1. Create a TanStack Start application

Skip this step if you already have one.

```sh
npx @tanstack/cli@latest create

# or

pnpm dlx @tanstack/cli@latest create
```

Select the Nitro (agnostic) adapter:

```text
◆  Select deployment adapter:
│  ○ None
│  ○ Cloudflare
│  ○ Netlify
│  ● Nitro (agnostic)
│  ○ Railway
└
```

### 2. Run the installer

From the application directory:

```sh
npx @byline/cli@latest init

# or

pnpm dlx @byline/cli@latest init
```

The installer works through a fixed sequence of phases — `preflight`,
`prompts`, `host`, `db`, `db-init`, `env`, `deps`, `wire`, `routes`,
`scaffold`, `seed-admin`, `seed-docs`, `ui`. Each phase first checks whether its
work is already done, then summarises what it will change; phases that write
files show the diff and wait for your confirmation. Re-running `init` is safe:
completed phases are detected and skipped, so an interrupted installation
resumes where it stopped. These phase names are the values `--only`, `--from`,
and `--to` accept.

### 3. Answer the prompts

| Prompt | Default | Notes |
|---|---|---|
| Where should the admin UI be mounted? | `/admin` | May be nested, such as `/internal/cms`. |
| Where should the sign-in page be mounted? | `/sign-in` | May be nested, such as `/staff/login`. |
| How will Byline connect to Postgres? | — | Choose the existing-server option, then give a superuser connection URL, a database name (default `byline`), and an application role (default `byline`). |
| Include the example collections, blocks, and fields? | yes | The overlay that mirrors `apps/webapp/byline` in this repo. |
| Include the markdown → Byline import example script? | no | Only asked when you kept the examples. |

### 4. Start the application

Start your application's dev server and open the admin path you chose (`/admin`
by default). Sign in with the super-admin credentials the installer wrote to
`.env.local`:

```sh
BYLINE_SUPERADMIN_EMAIL=...
BYLINE_SUPERADMIN_PASSWORD=...
```

If the admin UI does not come up, run `byline doctor` for a status grid of every
installation phase. Where a phase stopped with a manual instruction, compare
against the reference application in the Byline CMS main repo under
`apps/webapp`.

## After installation

The installer adds two application scripts. Run the first after any change to a
collection or block schema, and the second in CI:

```sh
pnpm byline:generate        # regenerate byline/generated/collection-types.ts
pnpm byline:generate:check  # fail without writing when the artifact is missing or stale
```

For AI-assisted editing, add the relevant provider API keys described in
`apps/webapp/.env.local.example`.

:::warning[Keep public and admin layouts separate]
The installer places Byline routes under the pathless `routes/_byline` layout.
Put the public application's top-level layout under a separate pathless route,
such as `routes/_frontend` or `routes/_public`. Move public styling, headers,
footers, and other layout concerns out of `__root.tsx` and into that public
layout's `route.tsx`. This prevents public application styles from affecting the
Byline dashboard.
:::

See the TanStack Router docs for [File-Based Routing](https://tanstack.com/router/latest/docs/routing/file-based-routing) and [Virtual File Routes](https://tanstack.com/router/latest/docs/routing/virtual-file-routes) for more information.

## Useful flags

```sh
byline init --dry-run             # show every change but write nothing
byline init --apply               # skip per-phase confirmations (still prints diffs)
byline init --only db-init        # run a single phase
byline init --from wire           # resume from a phase and continue to the end
byline init --force --apply -y    # re-detect and safely upgrade an older scaffold noninteractively
```

Run `byline init --help` for the full list.

## `byline setup` — already-wired applications

If you configured Byline by hand — copying the `byline` directory, `.env`,
`start`, `server`, `__root.tsx`, and `vite.config.ts` settings from the example
application — and only need to provision the database and seed it, use `setup`
instead of `init`. It runs the database and seed phases only and never modifies
project files:

```sh
# Provision the DB and seed both the super-admin and example docs (default)
byline setup

# Provision the DB and seed the super-admin only
byline setup --no-seed-docs

# Provision the DB and seed example docs only
byline setup --no-seed-admin

# Provision the DB without running either seed
byline setup --no-seed-admin --no-seed-docs

# Re-run every phase even if recorded as complete (non-destructive on its own —
# migrations re-apply as no-ops, seeds are idempotent)
byline setup --force

# Full nuke-and-pave: drop and recreate the database, then re-run every phase
byline setup --force --reset --i-mean-it
```

`setup` skips phases already recorded as complete; `--force` re-runs them
against fresh state. The destructive `--reset` flow always asks for
confirmation unless you pass `--i-mean-it`, and on an installation already
recorded complete it must be combined with `--force`. Before running, `setup`
checks that the required `@byline/*` packages and env files are in place — it
does not install or upgrade packages; use `byline init` for that.

## Technical notes

You do not need this section to install Byline. It documents what the installer
does under the hood, for when a phase stops with a manual instruction or you
are upgrading an older installation.

### Route paths and generated files

Admin and sign-in paths may be nested; every segment must match
`[a-z][a-z0-9-]*`. The installer rejects admin, API (resolved from
`byline/routes.ts`), and sign-in trees that overlap, requires sign-in to remain
outside both, and rejects roots that collide with locale prefixes,
`_serverFn`, `_build`, `uploads`, `static`, or `public`, plus any segment named
`index` or `route`, which is special to TanStack file routing.

Your answers are applied to both `byline/routes.ts` and the physical route
files below `src/routes/_byline/` — for example `/internal/cms` produces
`src/routes/_byline/internal/cms/...`. Changing `byline/routes.ts` alone does
not remount TanStack file routes, and `src/routeTree.gen.ts` must be
regenerated by TanStack rather than edited.

### How the CLI reads your configuration

The CLI never imports or executes your application config. It reads route and
locale configuration with a restricted static evaluator that understands
literals, object and array literals, same-file `const` references, static
spreads, `as const` / `satisfies`, and the directly imported `resolveRoutes()`
helper from `@byline/core`. Anything outside that subset — imported values,
`process.env`, arbitrary function calls — makes the evaluator fail closed: the
routes phase plans no writes rather than guessing.

### Package managers and workspaces

The installer uses the package manager declared by the workspace that owns the
application. In a monorepo, run it from the application directory: app files
stay there, while lockfiles and workspace-level settings are handled at the
owning workspace root. A `--pm` choice that conflicts with the owning
workspace is rejected; a noninteractive package.json-only workspace with no
manager metadata must pass `--pm`.

For pnpm, the installer creates or patches the owning `pnpm-workspace.yaml`
and merges the build approvals Byline's dependencies need (`@google/genai`,
`esbuild`, `protobufjs`, `sharp`) rather than asking you to stop for
`pnpm approve-builds`. Existing YAML is preserved; invalid YAML or a non-map
`allowBuilds` value is left for manual repair, and stale
`pnpm.onlyBuiltDependencies` configuration is removed because pnpm 10+ no
longer reads it.

### Reruns, upgrades, and safety

`byline init` structurally re-detects every phase on each run, so old completion
flags cannot hide files or configuration required by a newer CLI. Missing
generated artifacts and recognized generated predecessors are upgraded or
migrated automatically — including moving the admin or sign-in mount, which is
planned as one atomic change set. Divergent user-owned scaffold, route, Vite,
Turbo, and CI files are never deleted or overwritten: the affected change is
blocked or skipped and reported with a manual note instead.

Before applying a planned create, patch, or delete, the CLI re-checks every
target against the previewed state; if anything changed underneath the plan,
none of that write set is applied.

### Dependency policy

The CLI pins `@byline/*` packages to its own release line. For CLI `4.5.0`,
registry-backed ranges must fall within `>=4.5.0 <5.0.0-0`; missing or
incompatible declarations are planned at `^4.5.0`. Unbounded ranges and tags
such as `latest` are not accepted. `workspace:*`, `workspace:^`, and
`workspace:~` links are never replaced — the linked workspace package must
resolve locally and satisfy the same range, otherwise the dependency phase
blocks for manual repair.
