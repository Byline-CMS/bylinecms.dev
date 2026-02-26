# Byline CMS


Welcome to Byline CMS. We're new!

We're hoping to build a developer-friendly, open-source and community-driven AI-first headless CMS.

<img width="734" alt="byline-screeenshot-03" src="https://github.com/user-attachments/assets/c7d6efa1-71bb-4add-b0a2-34611f17be4c" />

<p style="font-size: 0.8rem;"><em>Tiny steps - the Byline prototype.</em></p>

## Mission / Vision
The developers of Byline CMS have worked extensively with non-profits and NGOs, and this work has shown us the profound value of certain freedoms: the freedom to own, control, and share content that deserves to be seen — freedoms that align perfectly with our vision for an open-source, community-driven platform for content management.

## FAQ

<details>
<summary>1. Why are you doing this?</summary>
Our mission statement pretty much sums up the 'why', but we also think there's a need. We're convinced that the three pillars of content management: 1) Workflow (draft, needs review, published, archived, etc.), 2) Versioning / history, and 3) Content language translation, are not mutually exclusive and that we can build a core framework that offers a foundation for all three without compromise. A 'headless' and 'structured content' architecture will also give developers (and ultimately users) the freedom to choose a framework or implementation approach that best suits their needs.
</details>

<details>
<summary>2. Who are you?</summary>
We’re pretty much nobody — at least not within the usual spheres of influence. We're an agency based in Southeast Asia, and we're fairly certain you've never heard of us. That said, we have a lot of experience building content solutions for clients — and we’re tired of fighting frameworks for core features our clients need and expect.
</details>

<details>
<summary>3. Will this work?</summary>
We hope so - but at this early stage, we have no idea.
</details>


<details>
<summary>4. What governance structures are you considering? </summary> 
We really like the governance structure of [Penpot](https://community.penpot.app/t/penpots-upcoming-business-model-for-2025/7328). We're committed to 100% open-source software, with no "open core" or "freemium" gotchas.
</details>

<details>
<summary>5. Would you accept sponsorship?</summary>
Yes!
</details>

<details>
<summary>6. Would you accept venture or seed-round investment?</summary>
We’re not certain yet, and likely not at this early stage. Our priority is to figure out key aspects of the project first. What we feel strongly about, however, is that community contributions should remain accessible — not locked behind an enterprise or paywalled solution. Ultimately, our governance structure and commitment to being community‑driven will guide any financial decisions we make.
</details>

<details>
<summary>7. What's here now?</summary>
We're working on a prototype as a 'proof of concept' for our design goals. It runs, and you're more than welcome to follow along, but it will almost certain change significantly over time.
</details>

<details>
<summary>8. Why the Mozilla Public License (MPL-2.0) Version 2.0?</summary>

We chose the MPL as we feel this represents the best balance between community-driven open source software, and allowing commercial value-based services to flourish.

The Mozilla Public License 2.0 (MPL-2.0) is often described as a “file-level copyleft” license. That means it sits somewhere between very permissive licenses (like MIT or BSD) and strong copyleft licenses (like GPL). In simple terms: if someone modifies MPL-licensed source files, those modified files must remain open and distributed under the MPL. However, they can combine those files with their own proprietary code in the same larger project, as long as they keep the MPL files separate and respect the license terms.

This creates a clear boundary. Improvements to the original open-source codebase stay open and benefit the community. At the same time, companies can build additional features, integrations, services, or proprietary modules around it without being required to open-source their entire product. The obligation applies only to the specific MPL-licensed files that are modified or redistributed — not to the entire application.

Practically speaking, if someone uses MPL-licensed software in a commercial product, they can sell that product, host it as a service, or build paid offerings around it. If they modify the original MPL files and distribute those modifications, they must make those specific changes available under the MPL. If they simply link to or use the software without modifying those files, there is no requirement to open their own independent code.

We feel the MPL will help to encourage collaboration and shared maintenance of the core platform, while still supporting sustainable commercial ecosystems — which is why many teams see MPL-2.0 as a pragmatic middle path between fully permissive and strongly reciprocal open-source licenses.
</details>

## Design Goals
1. We aim to create an extensible, plugin-based framework for our headless CMS — enabling users to easily build custom admin dashboards and UI rendering frameworks for front-end clients.
   
2. We'd like to create an immutable 'versioned-by-default' document store; which means document history by default, and tombstones (soft deletes) by default (including user restoration of tombstoned documents).

3. We'd like to do the same for collection definitions - 'versioned-by-default' with a superb migration experience. Imagine being able to query data on v1 of your collection definition, migrate the data in memory, and then save your migrated documents against v2 of your collection definition. Zero hoops and zero field wrangling.

4. We plan to support separate localization for the default admin dashboard interface and for content. In our past work, we’ve often built solutions where content is available in multiple languages, while the admin dashboard remains in just one or two locales. More importantly, changing a content field from non-localized to localized should not require a document collection migration.

5. We’ll make it easy to create alternative collection list views — whether for regular collections or media. You’ll also be able to reduce the selected fields for any list view, so there’s no need to retrieve full collection documents just to render a paginated list in the admin dashboard.

6. We're going to enable parent / child document relationships by default — ideal for creating documentation sites, or sub-areas in a site where navigation components can be built from child documents.

7. We're going to create a native 'file' field type that can be used in any collection definition, and separately from any defined media or upload collections (think Drupal files).

8. We'd like everything to be fast — like really fast — from admin bundle compile times to API responses.
   
9. While we’ll be focused on a small, opinionated core, we’re thinking big — offering enterprise-grade features like built-in content versioning (as described above), along with callbacks and webhooks support for consumer cache invalidation strategies (to name just a few).

7. For our admin dashboards, it should be easy to create content editors with your favorite editor, whether [CKEditor](https://ckeditor.com/), [Lexical](https://lexical.dev/), [TipTap](https://tiptap.dev/), [ProseMirror](https://prosemirror.net/) or other. We've spent years working with [contenteditable](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable) editors - like CKeditor, and more recently Lexical. Implementing a good editing experience, [including mobile support on Android](https://discuss.prosemirror.net/t/contenteditable-on-android-is-the-absolute-worst/3810) - is a significant task. Fortunately, we have a 'pretty good' and 'ready to go' opinionated Lexical implementation that will allow us to get off to a great start quickly with a suite of commonly requested editor features.

8. And more....

## Key Architectural Decisions

1. Universal Storage (Inverted Index / EAV-per-type): One of our experiments in this effort is the creation of a general purpose storage model that does not require per-collection schema deployments or migrations regardless of collection shape. It is similar to an  Entity-Attribute-Value store partitioned by type. Our typed store_* tables give us proper column types, indexability, and future full-text/GIN indexing — which we feel is a significant advantage over a single JSONB-per-document approach. We use a custom store path notation (content.1.photoBlock.0.display) as our addressing scheme for 'flattening' and 'reconstructing' documents.

2. Immutable Versioning: We save document versions by default (UUIDv7 time-ordered). This gives us built-in version history, enables eventual audit trails, and avoids in-place mutation. We use ROW_NUMBER() OVER PARTITION for resolving "latest" versions.

3. Patch-Based Updates: We accumulate DocumentPatch[] on the client and apply them server-side against the reconstructed document. Three patch families (field, array, block) cover the essential operations. We also feel our patch-based strategy is a good foundation for future collaborative editing (OT/CRDT).

4. Separate schema (collection schema) and 'presentation' configuration systems: We're fairly sure that a split schema from presentation concerns is the right way to go. The core idea is to have schema/data config defined separately from admin UI config (which references the schema). Something like this:

```ts
// collections/pages.schema.ts  (server-only, no UI concerns)
export const PagesSchema = defineCollection({
  slug: 'pages',
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'sub', type: 'textarea', localized: true },
    { name: 'content', type: 'blocks', blocks: ['richtext', 'photo'], required: true },
    slugField(),
    publishedOn(),
  ],
  access: { create: isAdminOrEditor, read: publishedOnly, /* ... */ },
  hooks: { /* ... */ }
})
```

```ts
// collections/pages.admin.tsx  (client-safe, UI-only)
import { PagesSchema } from './pages.schema'

export const PagesAdmin = defineAdmin(PagesSchema, {
  useAsTitle: 'title',
  group: 'Content',
  defaultColumns: ['title', 'publishedOn', '_status'],
  preview: (doc, { locale }) => `http://localhost:3000/${doc.slug}?locale=${locale}`,
  fields: {
    title: { /* custom component overrides */ },
    content: {
      editor: <LexicalEditor settings={minimalSettings} />,
    },
  },
})
```
The advantages of this approach:

- Schema definitions become truly server-only — no import-map strings, no admin blocks, no client components anywhere near them. They're plain data, trivially serializable, testable, and publishable as an API contract.
- Admin UI config can use real JSX and real imports because it's explicitly a client (or RSC) module. No string indirection needed.
- The schema can be consumed by other frontends (mobile, CLI tools, external APIs) without dragging admin UI baggage along.
- Type-safety improves: defineAdmin(PagesSchema, ...) can infer field names from the schema and offer autocomplete for UI overrides.

What it costs:

- Two files instead of one (or two declarations in a single file - though this is arguably better separation of concerns).
- A "linking" mechanism is needed so the framework knows which admin config belongs to which schema.
- Harder to see "the whole picture" at a glance for a single collection.

Prior art for this split:

- Django does exactly this: models (schema) are separate from ModelAdmin (admin site presentation). It's one of Django's most praised architectural decisions.
- Rails ActiveAdmin / Administrate: resource definitions are separate from their admin "dashboard" configuration.
- Sanity Studio v3: schema types are defined separately from "desk structure" (how the admin UI organizes and presents them). Custom input components are real React components, not string references.
- Keystatic: schema and UI ("reader" vs "admin") are somewhat separated by design.

## What is there to do?

Here's a list of things that will need to be done, in no particular order:

1. API: A published API specification with client libraries.

1. Field and Form APIs: Assuming we're going to build at least one implementation of an admin dashboard, we'll need APIs for generating admin app field and form UIs from collection definitions (what's here at the moment is a naïve implementation hacked together over a weekend). Think Drupal render arrays or Payload forms.

1. Compositional Block Strategy: As above, we need a strategy for block composition. Blocks are small(er) units of 'Field API' that can be reused, reordered, and specified as part of a collection's field definition.

1. Data Storage: We're working on what we think is a pretty good (and very fast) storage API. See above Architectural Decisions.

1. Security: Authentication (AuthN) and authorization (AuthZ) for the above including roles, abilities, admin account user management etc.

1. Accessability (a11y): The admin app (all flavours of the admin app, whether React, Preact, Svelte, Solid or other) needs to be accessible (like really).

1. Localization (i18n): Admin apps need to be localized (interface translations). Collection and field definitions (and therefore by default the API) - need to support localization (content translations).

1. Media: We need a media strategy - generation, storage, serving.

1. AI Native: It would be great if we could build this as AI native - meaning fields, agents, 'assistants' are baked in from the start.

1. Packages and Distribution Strategy: We'll need to extract and prepare packages in the monorepo for distribution.

1. UI Kit: The current UI kit is based on Infonomic's agency 'CSS Module / CSS only' UI kit. Some components are rolled from scratch. Others abstract / wrap publicly available components. Several components are based on Radix UI which is a great project. The kit is not complete and Radix-based components are being migrated to [Base UI](https://base-ui.com/). The style system has minimal theme / token definitions. Our preference for the moment is to continue with [@infonomic/uikit](https://github.com/infonomic/uikit) - but consider alternatives as appropriate.

1. And last but not least - AI/MCP integration: Once we feel the core is stable, we'll turn on the taps for AI integration (content translation, rephrasing, clarity etc.,) and first-class MCP support.

## Getting Started

At the moment, the project is a prototype, but it builds and runs if you wanted to poke around or follow along.

### 1. Clone and install dependencies

```sh
# git clone this repo
git clone git@github.com:Byline-CMS/bylinecms.dev.git
cd bylinecms.dev
# install rimraf global
pnpm install -g rimraf
# or npm install -g rimraf
# install deps
pnpm install
# build once so that all workspace packages and apps have their deps
pnpm build
```

### 2 Setup your database. 

The prototype currently requires PostgreSQL. There is a docker-compose.yml in the root postgres directory. Note that the default root password is set to 'test' in docker-compose.yml.

2.1. Create the 'data' subdirectory first, and then start postgres.

```sh 
# From the root of the project
cd postgres
mkdir data
# If you want to run docker detached, run './postgres.sh up -d'
./postgres.sh up

# And then 'down' if you want to remove the Docker container and network configuration when you're done.
./postgres.sh down 
```

2.2. Initialize the database and schema

We've just started to refactor db and other components into packages and adapters, with
only the postgres adapter available at the moment.

```sh
# Copy .env.example to .env in the apps/dashboard directory. 
# Read the notes in .env.example.
cd packages/db-postgres
cp .env.example .env

# Again, the default database root password is 'test' 
# (assuming you're using our docker-compose.yml file).
cd src/database 
./db_init.sh
cd ../..

# IMPORTANT: our ./db_init script sources (imports) common.sh, 
# which has a hardcoded value for the name of the development database.
# This is a 'foot gun' protection, so the script can only ever drop
# and recreate this database name. If you'd like to use a database
# name other than byline_dev - change the last line in common.sh, 
# as well as your corresponding .env settings.

# NOTE: While this project is in prototype development,
# you can optionally skip drizzle:generate since the latest
# migration will be included in the repo.

# You can optionally run pnpm drizzle:generate, although since 
# this is a development repo - migrations have already been generated 
# and committed.
# pnpm drizzle:generate
pnpm drizzle:migrate

# Optionally seed the database with documents.
# from /apps/webapp. Note that our seed script is in 
# apps/webapp (for now and for 'reasons')
cd apps/webapp
cp .env.example .env
pnpm tsx --env-file=.env byline/seed-bulk-documents.ts
```

### 3. Start dev mode

Again, from the root of the project and start the dev environment.

```sh
pnpm dev
```

If you've built the project (above) and have postgres up and running, you should be able to view the prototype on http://localhost:5173/

Enjoy and stay tuned!

## License

This project is licensed under the Mozilla Public License Version 2.0.
A copy of the full license text can be found in the LICENSE file.

Copyright © 2026 Infonomic Company Limited

For full details, please refer to the [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT) files in this repository.


### Major Contributors

* Anthony Bouch https://www.linkedin.com/in/anthonybouch/ anthony@infonomic.io 
* David Lipsky https://www.linkedin.com/in/david-lipsky-4391862a8/ david@infonomic.io 








