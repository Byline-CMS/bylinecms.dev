---
name: document
description: Create or revise developer documentation in Byline's standard format and plain-English style.
allowed-tools: Bash, Edit, Glob, Grep, Read, Write
argument-hint: [optional path/to/document.md] [optional brief]
---

Create or revise developer documentation.

## Arguments

Usage:

```text
/document [path/to/document.md] [optional brief]
```

Treat the first argument as `DOCUMENT_PATH` when it is a Markdown path. Paths
are relative to the repository root unless absolute.

- If `DOCUMENT_PATH` is provided, create or revise that exact file.
- If it is omitted, infer the target from the conversation and remaining
  arguments.
- If no path is provided and more than one destination is plausible, ask the
  user to choose before writing.
- Treat all text after the path, or all of `$ARGUMENTS` when no path is present,
  as the documentation brief.

## Before writing

1. Read the relevant implementation, manifests, tests, and existing present-state
   documentation. Treat executable configuration and code as authoritative.
2. Inspect nearby documents for terminology, links, and scope. Link to a companion
   document instead of repeating its full explanation.
3. Identify the reader's first questions and the minimum vocabulary needed to
   answer them. Put that orientation before implementation detail.

## Document format

Developer documentation under `docs/` uses YAML front matter:

```markdown
---
title: "Human-readable title"
path: "url-slug"
summary: "One concise sentence describing what the document explains."
---
```

The front matter `title` and the text of the first H1 must match exactly. The
document import and processing pipeline removes the first H1 and uses the front
matter title in its place.

Follow it with one H1 and a companion list:

```markdown
# Human-readable title

Companions:

- [Related topic](./relative-path.md) explains why it is relevant.
```

Put `Companions:` immediately below the H1. Use relative links. Include only
documents that help readers understand prerequisites, adjacent concepts, or a
more detailed contract.

## Writing style

- Write for developers who are evaluating or learning Byline, not only for
  maintainers who already know the implementation.
- Introduce the main concept and mental model first. Move exact APIs, limits,
  compatibility boundaries, implementation locations, and tests into later
  sections.
- Use clear, direct, grammatically complete sentences. Define a Byline-specific
  term before relying on it.
- Prefer concrete subjects such as "Byline's admin user interface", "the
  server", or "the Postgres adapter". Avoid vague shorthand such as "the admin".
- Describe what the system does directly. Avoid metaphors, slogans, compressed
  fragments, rhetorical flourishes, and language that requires the reader to
  infer unstated context.
- Keep paragraphs focused and remove repeated explanations. Use examples and
  small tables when they make a distinction easier to scan.
- State current behavior as current behavior. Clearly label plans or deferred
  work, and do not present speculation as architecture.
- Preserve important technical qualifications. Plain English should simplify
  the explanation, not broaden or weaken the contract.

## Verification

1. Re-read the finished document from the perspective of a developer new to the
   topic. Check that concepts appear before details that depend on them.
2. Verify code symbols, paths, commands, examples, limits, and behavioral claims
   against the current repository.
3. Run `git diff --check`.
4. Run `pnpm docs:check`.
5. Report the document changed, the main structural improvements, and the
   documentation-check result.
