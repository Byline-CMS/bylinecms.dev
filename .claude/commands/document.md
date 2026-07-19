---
name: document
description: Create or revise developer documentation in Byline's standard format and plain-English style.
allowed-tools: Bash, Edit, Glob, Grep, Read, Write
argument-hint: [optional path/to/document.md] [optional brief]
---

Create or revise developer documentation.

Follow the **writing-docs** skill for all structure, format, and style decisions —
this command only handles argument parsing, repository grounding, and the
verification gate. Read `.claude/skills/writing-docs/SKILL.md` and apply it to the
target document.

## Arguments

Usage:

```text
/document [path/to/document.md] [optional brief]
```

Treat the first argument as `DOCUMENT_PATH` when it is a Markdown path. Paths are
relative to the repository root unless absolute.

- If `DOCUMENT_PATH` is provided, create or revise that exact file.
- If it is omitted, infer the target from the conversation and remaining arguments.
- If no path is provided and more than one destination is plausible, ask the user to
  choose before writing.
- Treat all text after the path, or all of `$ARGUMENTS` when no path is present, as the
  documentation brief.

## Before writing

1. Read the relevant implementation, manifests, tests, and existing documentation.
   Treat executable configuration and code as authoritative.
2. Inspect nearby documents for terminology, links, and scope so Companions and shared
   vocabulary stay consistent.
3. Then follow the writing-docs skill: pick the doc type, apply the house format (front
   matter + exact H1/title match + Companions), write to the per-type skeleton and the
   universal bar, and hold to the documentation voice.

## Verification

Run the skill's self-check, then the mechanical gate:

1. Re-read the finished document as a developer new to the topic — concepts before the
   details that depend on them.
2. Verify code symbols, paths, commands, examples, limits, and behavioural claims against
   the current repository.
3. Run `git diff --check`.
4. Run `pnpm docs:check`.
5. Report the document changed, the main structural improvements, and the
   documentation-check result.
