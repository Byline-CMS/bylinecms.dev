# Contributing Guide #

Thank you for your interest in contributing to Byline CMS. This is a
generic guide that details how to contribute to the project in a way that
is efficient for everyone.

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

If you want to propose a change or bug fix via a pull request (PR),
you should first carefully read the section **Developer's Certificate of
Origin**. You must also format your code and commits according to the
instructions below.

If you intend to fix a bug, it's fine to submit a pull request right
away, but we still recommend filing an issue detailing what you're
fixing. This is helpful in case we don't accept that specific fix but
want to keep track of the issue.

If you want to implement or start working on a new feature, please
open a **question*- / **discussion*- issue for it. No PR
will be accepted without a prior discussion about the changes,
whether it is a new feature, an already planned one, or a quick win.

If it is your first PR, you can learn how to proceed from
[this free video
series](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github)

We use the `easy fix` tag to indicate issues that are appropriate for beginners.

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
- **scope** *(optional)* – the area of the codebase affected
  (e.g. `dashboard`, `db-postgres`, `core`, `i18n`).
- **subject** – a concise description in the imperative mood.
- **body** *(optional)* – additional context, motivation, or details.
- **footer** *(optional)* – references to issues, breaking-change
  notices (`BREAKING CHANGE: …`), etc.

### Commit Types

| Type | Emoji | Description |
|------|-------|-------------|
| `fix` | :bug: | A bug fix |
| `feat` | :sparkles: | A new feature |
| `perf` | :zap: | A performance improvement |
| `docs` | :books: | Documentation-only changes |
| `style` | :art: | Code style / formatting (no logic change) |
| `refactor` | :recycle: | Code change that neither fixes a bug nor adds a feature |
| `test` | :white_check_mark: | Adding or updating tests |
| `build` | :wrench: | Changes to the build system or dependencies |
| `ci` | :construction_worker: | CI/CD configuration changes |
| `chore` | :broom: | Miscellaneous tasks (e.g. .gitignore, tooling) |
| `hotfix` | :ambulance: | Critical bug fix requiring immediate release |

> **Breaking changes**: append `!` after the type/scope
> (e.g. `feat(api)!: remove legacy endpoint`) **and** include a
> `BREAKING CHANGE:` line in the footer.

### Rules

Each commit should have:

- A concise subject using the imperative mood.
- The subject should capitalize the first letter, omit the period
  at the end, and be no longer than 65 characters.
- A blank line between the subject line and the body.
- An entry in the CHANGES.md file if applicable, referencing the
  GitHub or Taiga issue/user story using these same rules.

### Examples

```
feat(admin): add modal for user profile editing

Introduces a reusable profile modal component that supports
avatar upload and field validation.

Closes #142
```

```
fix(db-postgres): set proper error message on generic query error
```

```
docs: add authentication process documentation
```

```
perf(admin): improve navigation rendering performance

Memoize route calculations to avoid unnecessary re-renders
on every navigation event.
```

```
feat(api)!: remove legacy /v1/auth endpoint

BREAKING CHANGE: The /v1/auth endpoint has been removed.
Clients must migrate to /v2/auth.

Closes #287
```

## Formatting and Linting ##

We're currently using [Biome](https://biomejs.dev/) as our linter / formatter.
There is a lint script command in packages.json, as well as plugins available for several IDEs.


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

Then, all your code patches (**documentation is excluded**) should
contain a sign-off at the end of the patch/commit description body. It
can be automatically added by adding the `-s` parameter to `git commit`.

This is an example of what the line should look like:

```
Signed-off-by: Burbury Brown <burbury@brown.in>
```

Please, use your real name (sorry, no pseudonyms or anonymous
contributions are allowed).