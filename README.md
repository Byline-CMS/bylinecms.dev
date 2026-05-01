# Byline CMS

A developer-friendly, open-source headless CMS — built so versioning,
editorial workflow, and content translation are first-class concerns rather
than features bolted on later.

> Status: early beta. The shape is settling, the core is stable enough to
> build on, and you're welcome to follow along.

<img width="914" height="685" alt="byline-admin" src="https://github.com/user-attachments/assets/1d4a6a02-b847-4e66-b8c9-9fb8964a2287" />

<p style="font-size: 0.8rem;"><em>Welcome to the Byline dashboard!</em></p>

## What's different

- **Three pillars, not three plugins.** Versioning, editorial workflow, and
  content translation are foundational and designed to coexist without
  trade-offs.
- **Universal storage (EAV-per-type).** Schemas change without migrations.
  Documents flatten into typed `store_*` tables (text, numeric, boolean,
  datetime, json, file, relation) addressed by a custom path notation —
  indexable, query-friendly, and the basis for selective field loading.
- **Immutable versioning by default.** Every change creates a new
  UUIDv7-ordered version. "Current" is a pointer, not a mutation.
- **Patch-based updates.** Clients accumulate `DocumentPatch[]`; the server
  applies them against the reconstructed document. A foundation for
  collaborative editing later.
- **Schema separated from presentation.** Collection definitions are
  server-safe data; admin UI lives in a parallel `defineAdmin()` config —
  Django models vs ModelAdmin, applied to headless content.

For the longer story, see [docs/MISSION.md](docs/MISSION.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

- **[docs/](docs/)** — reference documentation for each subsystem
  (storage, collection versioning, relationships, file uploads, auth,
  client SDK, routing, richtext editor, core composition roadmap).
- **[docs/MISSION.md](docs/MISSION.md)** — why Byline exists, the three
  pillars, building in the open, and a note on how we use AI in
  development.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — key architectural
  decisions in depth, with code examples.
- **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** — full setup,
  including Postgres bring-up and seeding.
- **[docs/CONTENT-IN-THE-TIME-OF-AI.md](docs/CONTENT-IN-THE-TIME-OF-AI.md)**
  — why we think structured content management matters more, not less,
  alongside generative AI.
- **Package design docs** sit close to their packages — e.g.
  [packages/client/DESIGN.md](packages/client/DESIGN.md).

## Quick start

```sh
git clone git@github.com:Byline-CMS/bylinecms.dev.git
cd bylinecms.dev
pnpm install -g rimraf
pnpm install
pnpm build
```

Bring up Postgres (Docker, default password `test`):

```sh
cd postgres && mkdir data
./postgres.sh up -d
```

Initialise the database, run migrations, and seed:

```sh
cd packages/db-postgres && cp .env.example .env
cd src/database && ./db_init.sh && cd ../..
pnpm drizzle:migrate

cd ../../apps/webapp && cp .env.example .env
pnpm tsx --env-file=.env byline/seed.ts
```

Then from the project root:

```sh
pnpm dev
```

Open http://localhost:5173/.

Full notes — including the foot-gun protection on `db_init`, alternate
database names, and what the seed does — are in
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## FAQ

<details>
<summary>1. Who are you?</summary>
We’re pretty much nobody — at least not within the usual spheres of influence. We're an agency based in Southeast Asia, and we're fairly certain you've never heard of us. That said, we have a lot of experience building content solutions for clients — and we’re tired of fighting frameworks for core features our clients need and expect.
</details>

<details>
<summary>2. Will this work?</summary>
We hope so. Early beta means the core is stable enough to build on, but we're still discovering what the edges should look like.
</details>

<details>
<summary>3. What governance structures are you considering?</summary>
We really like the governance structure of [Penpot](https://community.penpot.app/t/penpots-upcoming-business-model-for-2025/7328). We're committed to 100% open-source software, with no "open core" or "freemium" gotchas.
</details>

<details>
<summary>4. Would you accept sponsorship?</summary>
Yes!
</details>

<details>
<summary>5. Would you accept venture or seed-round investment?</summary>
We’re not certain yet, and likely not at this early stage. Our priority is to figure out key aspects of the project first. What we feel strongly about, however, is that community contributions should remain accessible — not locked behind an enterprise or paywalled solution. Ultimately, our governance structure and commitment to being community‑driven will guide any financial decisions we make.
</details>

<details>
<summary>6. What's here now?</summary>
Byline is in early beta. The storage, versioning, workflow, auth, client SDK, and admin UI are all in place. Expect changes as we move toward v1, but the core architecture is stable.
</details>

<details>
<summary>7. Why the Mozilla Public License (MPL-2.0) Version 2.0?</summary>

We chose the MPL as we feel this represents the best balance between community-driven open source software, and allowing commercial value-based services to flourish.

The Mozilla Public License 2.0 (MPL-2.0) is often described as a “file-level copyleft” license. That means it sits somewhere between very permissive licenses (like MIT or BSD) and strong copyleft licenses (like GPL). In simple terms: if someone modifies MPL-licensed source files, those modified files must remain open and distributed under the MPL. However, they can combine those files with their own proprietary code in the same larger project, as long as they keep the MPL files separate and respect the license terms.

This creates a clear boundary. Improvements to the original open-source codebase stay open and benefit the community. At the same time, companies can build additional features, integrations, services, or proprietary modules around it without being required to open-source their entire product. The obligation applies only to the specific MPL-licensed files that are modified or redistributed — not to the entire application.

Practically speaking, if someone uses MPL-licensed software in a commercial product, they can sell that product, host it as a service, or build paid offerings around it. If they modify the original MPL files and distribute those modifications, they must make those specific changes available under the MPL. If they simply link to or use the software without modifying those files, there is no requirement to open their own independent code.

We feel the MPL will help to encourage collaboration and shared maintenance of the core platform, while still supporting sustainable commercial ecosystems — which is why many teams see MPL-2.0 as a pragmatic middle path between fully permissive and strongly reciprocal open-source licenses.
</details>

## License

Mozilla Public License 2.0. See [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT).

Copyright © 2026 Infonomic Company Limited

### Major Contributors

- Anthony Bouch — https://www.linkedin.com/in/anthonybouch/ — anthony@infonomic.io
- David Lipsky — https://www.linkedin.com/in/david-lipsky-4391862a8/ — david@infonomic.io
