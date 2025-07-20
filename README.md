[![CLA assistant](https://cla-assistant.io/readme/badge/Byline-CMS/bylinecms.app)](https://cla-assistant.io/Byline-CMS/bylinecms.app)

# Byline CMS


Welcome to Byline CMS. We're new!

We're hoping to build a developer-friendly, customer-friendly, AI-first headlesss CMS.

<img width="734" alt="byline-screeenshot-03" src="https://github.com/user-attachments/assets/c7d6efa1-71bb-4add-b0a2-34611f17be4c" />

<p style="font-size: 0.8rem;"><em>Tiny steps - the Byline prototype.</em></p>

Here's a no-frills FAQ.

## FAQ

<details>
<summary>1. Why are you doing this?</summary>
The initial maintainers of this project are also users of Payload CMS — which is a great project, with a few caveats and one recent development. One caveat is that as of version 3.0 Payload CMS has become a technically complex project, in particular after its integration with Next.js (we like Next.js, but are not sure about Payload's integration). More importantly, Payload CMS was just acquired by Figma. And so we felt there would be no harm (and maybe even some fun) in exploring an alternative while we try to understand more about what this means for the future of Payload.
</details>

<details>
<summary>2. Who are you?</summary>
We’re pretty much nobody — at least not within the usual spheres of influence. We're a couple of developers at an agency based in Southeast Asia, and we're fairly certain you've never heard of us. That said, we have over a decade of experience building content solutions for clients — and we’re tired of fighting frameworks for core features our clients need and expect.
</details>

<details>
<summary>3. Will this work?</summary>
We have no idea.
</details>


<details>
<summary>4. What governance structures are you considering? </summary> 
We really like the governance structure of the [Fastify project](https://github.com/fastify/.github/blob/main/GOVERNANCE.md). We're going to look for advice over the coming days and weeks and try to find a governance structure that reflects our hopes and values.
</details>

<details>
<summary>5. Would you accept sponsorship?</summary>
Yes!
</details>

<details>
<summary>6. Would you accept venture or seed-round investment?</summary>
Probably not — at least not at this stage. We still have a lot to figure out. What we do feel strongly about, however, is that community contributions should remain within the community — and not locked behind an 'enterprise' or paywalled solution.
</details>

<details>
<summary>7. What's here now?</summary>
Not much: The embryo of a 'proof of concept' CMS - but there will be more soon.
</details>

<details>
<summary>8. Will you fork Payload CMS?</summary>
Absolutely not. There would be no point in taking on the complexity of Payload when it's the complexity of the project itself we'd like to avoid. 
</details>

<details>
<summary>9. Why is the project's copyright assigned to Anthony Bouch?</summary>
While we're still finding our feet in terms of overall strategy, we felt it would be simpler if we assigned all copyright to Anthony Bouch as the initial steward of the project (also the lead maintainer of the  project at the moment). We have a CLA that has been implemented via [https://cla-assistant.io/](https://cla-assistant.io/). You can read more about the AGPL 3.0 license here [https://fossa.com/blog/open-source-software-licenses-101-agpl-license/](https://fossa.com/blog/open-source-software-licenses-101-agpl-license/) We'll update this section as soon as there is more to report. 
</details>

## Design Goals
1. We aim to create an extensible, plugin-based framework for our headless CMS — enabling users to easily build custom admin dashboards and UI rendering frameworks for front-end clients.
   
2. We'd like to create an immutable 'versioned-by-default' document store; which means document history by default, and tombstones (soft deletes) by default (including user restoration of tombstoned documents).

3. We'd like to do the same for collection definitions - 'versioned-by-default' with a superb migration experience. Imagine being able to query data on v1 of your collection definition, migrate the data in memory, and then save your migrated documents against v2 of your collection definition. Zero hoops and zero field wrangling.

4. We plan to support separate localization for the default admin dashboard interface and for content. In our past work, we’ve often built solutions where content is available in multiple languages, while the admin dashboard remains in just one or two locales. More importantly, changing a content field from non-localized to localized should not require a document collection migration.

5. We’re making it easy to create alternative collection list views — whether for regular collections or media. You’ll also be able to reduce the selected fields for any list view, so there’s no need to retrieve full collection documents just to render a paginated list in the admin dashboard.

6. We're going to create a native 'file' field type that can be used in any collection definition, and separately from any defined media or upload collections (think Drupal files).

7. We'd like everything to be fast - like really fast - from admin bundle compile times to API responses.
   
8. While we’ll be focused on a small, opinionated core, we’re thinking big — offering enterprise-grade features like built-in content versioning (as described above), along with callbacks and webhooks support for consumer cache invalidation strategies (to name just a few).

7. For our admin dashboards, it should be easy to create content editors with your favorite editor, whether [CKEditor](https://ckeditor.com/), [Lexical](https://lexical.dev/), [TipTap](https://tiptap.dev/), [ProseMirror](https://prosemirror.net/) or other. We've spent years working with [contenteditable](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable) editors - like CKeditor, and more recently Lexical. Implementing a good editing experience, [including mobile support on Android](https://discuss.prosemirror.net/t/contenteditable-on-android-is-the-absolute-worst/3810) - is a significant task. Fortunately, we have a 'pretty good' and 'ready to go' opinionated Lexical implementation that will allow us to get off to a great start quickly with a suite of commonly requested editor features.

8. And more....

## What's Next?
We need to find our feet, choose license, publish a roadmap, code of conduct, our values and mission statement, as well as settle on a governance model and likely stewardship entity. We've published the prototype under the [AGPL](https://www.gnu.org/licenses/agpl-3.0.en.html) license - for now, as we understand this has implications. Before we accept contributions, we'll likely switch to a more permissive license like Apache 2.0 (this requires consent or a CLA from contributors, which is fine while there's just a few of us).

## What is there to do?

Here's a list of things that will need to be done, in no particular order:

1. API: A published API specification with client libraries.

1. Field and Form APIs: Assuming we're going to build at least one implementation of an admin dashboard, we'll need APIs for generating admin app field and form UIs from collection definitions (what's here at the moment is a naïve implementation hacked together over a weekend). Think Drupal render arrays or Payload forms.

1. Compositional Block Strategy: As above, we need a strategy for block composition. Blocks are small(er) units of 'Field API' that can be reused, reordered, and specified as part of a collection's field definition.

1. Data Storage: We're working on what we think is a pretty good (and very fast) storage API. Stay tuned...

1. Security: Authentication (AuthN) and authorization (AuthZ) for the above including roles, abilities, admin account user management etc.

1. Accessability (a11y): The admin app (all flavours of the admin app, whether React, Preact, Svelte, Solid or other) needs to be accessible (like really).

1. Localization (i18n): Admin apps need to be localized (interface translations). Collection and field definitions (and therefore by default the API) - need to support localization (content translations).

1. Media: We need a media strategy - generation, storage, serving.

1. AI Native: It would be great if we could build this as AI native - meaning fields, agents, 'assistants' are baked in from the start.

1. Packages and Distribution Strategy: We'll need to extract and prepare packages in the monorepo for distribution.

1. UI Kit: The Byline UI kit is a 'CSS Module / CSS only' UI kit. Some components are rolled from scratch. Others abstract / wrap publicly available components. Several components are based on Radix UI which is a great project. The kit is not complete, and so we should evaluate other sources like [BaseUI](https://base-ui.com/) (which is also excellent), or [React Aria Components](https://react-spectrum.adobe.com/react-aria/components.html) (a superb project). The style system has minimal theme / token definitions. These should be expanded. Docs for the ui kit are Storybook `cd packages/uikit && pnpm storybook` to start the Storybook server.

11. Tests: tests, tests, tests.

Plus lots more... whew!

## Getting Started

At the moment, the project is mostly a prototype and 'weekend hack'. But it builds and runs if you wanted to poke around or follow along.

### 1. Clone and install dependencies

```sh
# git clone this repo
git clone git@github.com:Byline-CMS/bylinecms.app.git
cd bylinecms.app
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
./postgres.sh up

# And then 'down' if you want to remove the Docker container and network configuration when you're done.
./postgres.sh down 
```

2.2. Initialize the database and schema
```sh
# Copy .env.example to .env in the apps/api directory. 
# Read the notes in .env.example.
cd apps/api
cp .env.example .env

# Again, the default database root password is 'test' 
# (assuming you're using our docker-compose.yml file).
cd database && ./db_init
cd ..

# IMPORTANT: our ./db_init script sources (imports) common.sh, 
# which has a hardcoded value for the name of the development database.
# This is a 'foot gun' protection, so the script can only ever drop
# and recreate this database name. If you'd like to use a database
# name other than byline_dev - change the last line in common.sh, 
# as well as your corresponding .env settings.
# NOTE: While this project is in prototype development,
# you can optionally skip drizzle:generate since the latest
# migration will be included in the repo.
pnpm drizzle:generate
pnpm drizzle:migrate

# Optionally seed the database with documents.
# from /apps/api
tsx --env-file=.env database/seeds/seed-bulk-documents.ts 
```

### 3. Start dev mode

Again, from the root of the project and start the dev environment.

```sh
pnpm dev
```

If you've built the project (above) and have postgres up and running, you should be able to view the prototype on http://localhost:5173/

Enjoy and stay tuned!

## License

Byline CMS is free software licensed under the GNU Affero General Public License v3.0 or later.
For full details, please refer to the [LICENSE](LICENSE) and [COPYRIGHT](COPYRIGHT) files in this repository.

Copyright © 2025 Anthony Bouch and contributors.

### Major Contributors

* Anthony Bouch
* David Lipsky








