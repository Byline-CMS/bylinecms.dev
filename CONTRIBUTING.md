# Contributing Guide #

Thank you for your interest in contributing to Byline CMS. This guide
explains how to contribute in a way that works for everyone — including,
right now, one significant limit.

**Pull request creation is currently restricted to repository
collaborators.** Issues and discussions are open to everyone, and they are
where we would most like to hear from you. The [Pull
Requests](#pull-requests) section explains the reasoning, and
[AI-Assisted Contributions](#ai-assisted-contributions) covers what we can
and cannot act on.

## Ways to Contribute ##

- **[Discussions](https://github.com/Byline-CMS/bylinecms.dev/discussions)**
  — questions, ideas, feature proposals, and "is this a bug, or am I
  holding it wrong?" Use **Q&A** when you are stuck, **Ideas** when you
  want to propose something, and **Show and tell** if you have built
  something on Byline. We read all of them.
- **[Issues](https://github.com/Byline-CMS/bylinecms.dev/issues)** —
  reproducible bugs, and concrete, well-scoped suggestions. The issue
  tracker is also our public roadmap, so triaged issues are how work gets
  queued.
- **Documentation.** Corrections, gaps, and passages that did not make
  sense to you on a first read are genuinely useful reports. Tell us which
  document and which section.
- **Evaluating Byline and telling us what broke.** We develop Byline
  against our own production sites, which means our blind spots are
  systematic ones. Someone using Byline for something we would never have
  thought of is worth a great deal to us.

## Reporting Bugs ##

We are using [GitHub Issues](https://github.com/Byline-CMS/bylinecms.dev/issues)
for our public bugs. We keep a close eye on them and try to make it
clear when we have an internal fix in progress. Before filing a new
task, try to make sure your problem doesn't already exist.

If you found a bug, please report it, as far as possible, with:

- a detailed explanation of steps to reproduce the error
- the browser and browser version used
- a dev tools console exception stack trace (if available)

If you found a bug which you think is better to discuss in private (for
example, security bugs), consider first sending an email to
`support@infonomic.io`.

**We don't have a formal bug bounty program for security reports; this
is an open source application, and your contribution will be recognized
in the changelog.**


## Pull Requests ##

**Pull request creation is currently restricted to repository
collaborators.** GitHub enforces this at the repository level, so if you
are not a collaborator you will not be able to open one. Nothing else
changes: the repository stays public and readable, you can clone and fork
it and build on it under the terms of the MPL-2.0 licence, existing pull
requests remain readable, and issues and discussions are open to everyone.

We have not turned this on in response to anything. We have had no
unsolicited pull requests at all so far. We are setting the expectation
before it matters, for three reasons.

1. **We are a small team.** Review capacity is our scarcest resource. An
   unreviewed pull request sitting open for months is a worse outcome for
   its author than a clear "not right now" would have been.

2. **The codebase is moving quickly.** Byline is in active development, and
   whole subsystems have been restructured within a single minor line. A
   patch against an area we are about to rewrite cannot be merged however
   good it is, and that is a discouraging thing to find out after you have
   already done the work. Agreeing on the change first protects your time
   more than ours.

3. **We want our guidance on AI-assisted contributions settled first.** See
   the next section. We would rather say what we can act on before patches
   start arriving than retrofit a policy afterwards.

We intend to open pull requests up as the
architecture settles and our own rate of change slows, and we will say so
clearly here when we do.

### What to do instead ###

Open an [issue](https://github.com/Byline-CMS/bylinecms.dev/issues) or a
[discussion](https://github.com/Byline-CMS/bylinecms.dev/discussions). This
is not a consolation prize — it is the contribution we most need right now.
A bug report we can reproduce, or a proposal with the reasoning behind it,
feeds directly into our roadmap: we triage it, verify it, and raise the
issue and the pull request ourselves.

If you have already written a fix, describe the change in an issue and link
to a branch on your fork. We will read it. If we agree the change is right
and want your commits, we would much rather arrange access for you than
reimplement your work and take the credit for it.

### For collaborators ###

The rest of this guide applies. Read the **Developer's Certificate of
Origin** section below, and follow the commit and formatting conventions.

If you intend to fix a bug, it is fine to open a pull request right away,
but we still recommend filing an issue describing what you are fixing. That
way we can track the underlying problem even if we do not take that
specific fix.

If you want to implement or start working on a new feature, open a
`question` or `enhancement` issue for it first. No pull request will be
accepted without a prior discussion about the change, whether it is a new
feature, an already-planned one, or a quick win.

We use the `good first issue` and `help wanted` labels to mark work that is
well scoped enough to pick up without deep familiarity with the codebase.

## AI-Assisted Contributions ##

We use AI assistance extensively in Byline's own development, and we have
written about how and why in [A note on AI usage in the development of
Byline](docs/02-why-byline/01-mission.md). So this section is not a
prohibition on tools, and we are not going to ask you to declare which
editor you used.

What we cannot absorb is output that nobody has read. Three failure modes
in particular cost us far more than they contribute:

- A generated bug report that describes plausible behaviour the software
  does not actually have. It takes longer to investigate and dismiss than a
  real bug takes to fix.
- A generated feature proposal assembled by reading the README and the
  documentation. It tells us what a model inferred from our own words, not
  what you need. We already know what we wrote.
- A generated patch whose author cannot explain it. We cannot review it, we
  cannot maintain it, and it is not something anyone can honestly sign off
  under the Developer's Certificate of Origin below — which asks you to
  certify that you wrote the contribution, or otherwise have the right to
  submit it.

So, whatever you used to help write it:

- **Run it against the software before you file it.** Bug reports need real
  reproduction steps from a real run, against a stated version.
- **Say what you actually need, in your own words, and why.** A short,
  specific paragraph from somebody using Byline is worth more to us than a
  long, well-structured document.
- **Be able to explain and defend every line you submit.** If you cannot
  say why a change is written the way it is, it is not ready.
- **Do not file at scale.** Batches of generated issues, and drive-by
  refactor or dependency-bump pull requests, will be closed without
  discussion.

If an agent helped you track something down and that is worth mentioning,
mention it — we are interested. We are not suspicious of the tooling. We
just need a person on the other end of the conversation.

## Commit Guidelines ##

We follow the [Conventional Commits](https://www.conventionalcommits.org/)
approach to commit messages. Conventional Commits provide a lightweight
convention on top of commit messages that makes it easier to understand
the history of a project, automate changelogs, and determine semantic
version bumps.

### Format

The commit message format is:

```
<type>(<scope>): <subject>

[body]

[footer]
```

- **type** – describes the category of the change (see table below).
- **scope** *(optional)* – the area of the codebase affected, usually the
  package name without its `@byline/` prefix (`core`, `db-postgres`,
  `admin`, `i18n`, `webapp`). A change spanning two closely related
  packages may list both: `fix(db-mysql,db-postgres): …`. Omit the scope
  for cross-cutting changes.
- **subject** – a concise description, lowercase, in the past tense (see
  **Rules** below).
- **body** *(optional)* – additional context, motivation, or details.
- **footer** *(optional)* – the DCO sign-off, and an issue reference such
  as `Closes #142`.

### Commit Types

| Type | Description |
|------|-------------|
| `feat` | A new feature or significant enhancement |
| `fix` | A bug fix |
| `docs` | Documentation-only changes |
| `refactor` | Restructuring that neither fixes a bug nor adds a feature |
| `perf` | A performance improvement |
| `test` | Adding or updating tests |
| `style` | Formatting and whitespace, with no logic change. Not CSS — visual changes are `feat` or `fix` |
| `chore` | Maintenance with no runtime behaviour change (tooling, `.gitignore`, release commits) |
| `chore(deps)` | Dependency updates |
| `ci` | CI/CD configuration changes |

We do not use emoji in commit subjects.

> **Breaking changes**: append `!` after the type or scope
> (e.g. `feat(client)!: removed the legacy find signature`) **and** include
> a `BREAKING CHANGE:` line in the footer. This is rare here. Byline's
> major-version bumps are driven by lockstep versioning across the
> publishable `@byline/*` packages rather than by breaking redesigns, so a
> major release is not on its own evidence that a breaking change landed.

### Rules

Each commit should have:

- A subject that is **lowercase after the colon** and written in the **past
  tense** — `added`, `fixed`, `removed`, `updated`. This is the one place
  we diverge from the Conventional Commits examples, which use the
  imperative. Match the repository.
- No trailing period on the subject, unless it runs to more than one
  sentence.
- A subject short enough to scan in a `git log --oneline`. There is no
  enforced character limit, but if you are much past 70 characters the
  detail probably belongs in the body.
- A blank line between the subject and the body.
- A reference to the GitHub issue in the footer where one exists
  (`Closes #142`).
- A `Signed-off-by` trailer — see
  [Developer's Certificate of Origin](#developers-certificate-of-origin-dco)
  below. It is the **only** trailer we permit: no `Co-Authored-By`, no AI
  attribution, no others.
- A [changeset](https://github.com/changesets/changesets) (`pnpm changeset`)
  for any change that affects a published `@byline/*` package. Changesets
  drive the release notes and the lockstep version bump.

### Examples

```
feat(admin): added a modal for user profile editing

Introduces a reusable profile modal component that supports
avatar upload and field validation.

Closes #142

Signed-off-by: Burbury Brown <burbury@brown.in>
```

```
fix(db-postgres): set a proper error message on generic query errors

Signed-off-by: Burbury Brown <burbury@brown.in>
```

```
docs: added the authentication process documentation

Signed-off-by: Burbury Brown <burbury@brown.in>
```

```
perf(admin): memoized route calculations in the navigation

Avoids unnecessary re-renders on every navigation event.

Signed-off-by: Burbury Brown <burbury@brown.in>
```

```
chore(deps): updated deps

Signed-off-by: Burbury Brown <burbury@brown.in>
```

## Formatting and Linting ##

We use [Biome](https://biomejs.dev/) for both linting and formatting. There is
no ESLint or Prettier in the project; please don't add them.

**Three layers keep formatting consistent — you mostly don't have to think
about it:**

1. **Pre-commit hook (automatic).** `pnpm install` registers a
   [`simple-git-hooks`](https://github.com/toplenboren/simple-git-hooks) +
   [`lint-staged`](https://github.com/lint-staged/lint-staged) pre-commit hook
   that runs `biome check --write --unsafe` against staged `.js` / `.ts` /
   `.tsx` / `.json` / `.jsonc` files. Auto-fixable issues are corrected and
   re-staged before the commit lands. Nothing you have to set up — it ships
   with the repo.

2. **Your editor (recommended).** Biome ships first-party plugins for VS
   Code, JetBrains, Zed, neovim, and others. The
   [Biome editor integrations page](https://biomejs.dev/guides/editors/first-party-extensions/)
   covers every supported editor; pick yours, install the plugin, and enable
   format-on-save. Once configured, your editor applies the same rules as
   the hook and CI, so you see issues as you type.

3. **CI (the authoritative gate).** Every PR runs `pnpm lint` (and
   `pnpm typecheck`). A PR with lint failures cannot merge. If the
   pre-commit hook didn't catch something — for example, a commit made
   with `--no-verify` — CI will.

If you need to run the linter manually:

```sh
pnpm lint        # entire workspace (auto-fix + format)
pnpm typecheck   # type-check across packages
```

For the test suite, see [`docs/09-testing.md`](./docs/09-testing.md).


## Code of Conduct ##

We have published a detailed Code of Conduct as a separate document in this repo. Please take a moment to read this before contributing. Contributors demonstrating a pattern of violation of community standards, including sustained inappropriate behavior,  harassment of an individual, or aggression toward or disparagement of classes of individuals will be subject to a permanent ban from the project.


## Developer's Certificate of Origin (DCO)

By submitting code you agree to and can certify the following:

    Developer's Certificate of Origin 1.1

    By making a contribution to this project, I certify that:

    (a) The contribution was created in whole or in part by me and I
        have the right to submit it under the open source license
        indicated in the file; or

    (b) The contribution is based upon previous work that, to the best
        of my knowledge, is covered under an appropriate open source
        license and I have the right under that license to submit that
        work with modifications, whether created in whole or in part
        by me, under the same open source license (unless I am
        permitted to submit under a different license), as indicated
        in the file; or

    (c) The contribution was provided directly to me by some other
        person who certified (a), (b) or (c) and I have not modified
        it.

    (d) I understand and agree that this project and the contribution
        are public and that a record of the contribution (including all
        personal information I submit with it, including my sign-off) is
        maintained indefinitely and may be redistributed consistent with
        this project or the open source license(s) involved.

**Every commit must carry a sign-off**, including documentation-only
commits. Pull requests are gated by an automated DCO check, and a single
unsigned commit anywhere in the branch will fail it. Add the sign-off by
passing `-s` to `git commit`:

```sh
git commit -s -m "docs: corrected the storage reference"
```

This is what the resulting trailer looks like:

```
Signed-off-by: Burbury Brown <burbury@brown.in>
```

It must match the name and email address configured in your Git identity
(`git config user.name` and `user.email`). Please use your real name —
sorry, no pseudonyms or anonymous contributions.

As noted under [Commit Guidelines](#commit-guidelines), `Signed-off-by` is
the only trailer we permit. If you forgot the sign-off on commits you have
already made, `git rebase --signoff <base>` will add it across a range
before you push.
