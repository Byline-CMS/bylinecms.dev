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

We follow the conventional commit approach to commit messages.

The commit message format is:

```
<type> <subject>

[body]

[footer]
```

Where type is:

- :bug: `:bug:` a commit that fixes a bug
- :sparkles: `:sparkles:` a commit that adds an improvement
- :tada: `:tada:` a commit with a new feature
- :recycle: `:recycle:` a commit that introduces a refactor
- :lipstick: `:lipstick:` a commit with cosmetic changes
- :ambulance: `:ambulance:` a commit that fixes a critical bug
- :books: `:books:` a commit that improves or adds documentation
- :construction: `:construction:` a WIP commit
- :boom: `:boom:` a commit with breaking changes
- :wrench: `:wrench:` a commit for config updates
- :zap: `:zap:` a commit with performance improvements
- :whale: `:whale:` a commit for Docker-related stuff
- :paperclip: `:paperclip:` a commit with other non-relevant changes
- :arrow_up: `:arrow_up:` a commit with dependency updates
- :arrow_down: `:arrow_down:` a commit with dependency downgrades
- :fire: `:fire:` a commit that removes files or code
- :globe_with_meridians: `:globe_with_meridians:` a commit that adds or updates
  translations

More info:

 - https://gist.github.com/parmentf/035de27d6ed1dce0b36a
 - https://gist.github.com/rxaviers/7360908

Each commit should have:

- A concise subject using the imperative mood.
- The subject should capitalize the first letter, omit the period
  at the end, and be no longer than 65 characters.
- A blank line between the subject line and the body.
- An entry in the CHANGES.md file if applicable, referencing the
  GitHub or Taiga issue/user story using these same rules.

Examples of good commit messages:

- `:bug: Fix unexpected error on launching modal`
- `:bug: Set proper error message on generic error`
- `:sparkles: Enable new modal for profile`
- `:zap: Improve performance of dashboard navigation`
- `:wrench: Update default backend configuration`
- `:books: Add more documentation for authentication process`
- `:ambulance: Fix critical bug on user registration process`
- `:tada: Add new approach for user registration`

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
Signed-off-by: Andrey Antukh <niwi@niwi.nz>
```

Please, use your real name (sorry, no pseudonyms or anonymous
contributions are allowed).