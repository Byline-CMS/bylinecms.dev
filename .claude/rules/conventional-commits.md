# Conventional Commits

All git commits in this project MUST use conventional commit format.

## Format

```
type(scope): lowercase message in past tense
```

## Types

- `feat:` — new feature or significant enhancement
- `fix:` — bug fix
- `chore:` — maintenance (no runtime behaviour change)
- `chore(deps):` — dependency updates
- `refactor:` — restructuring without behaviour change
- `docs:` — documentation only
- `test:` — test changes
- `style:` — formatting/whitespace (not CSS — those are feat/fix)
- `ci:` — CI/CD changes
- `perf:` — performance improvements

## Scope

Optional. Use when changes are confined to one area: `feat(search):`, `fix(i18n):`, `chore(deps):`.
Omit for cross-cutting changes.

## Style rules

- Lowercase after the colon
- Past tense preferred: "updated", "added", "fixed", "removed"
- Concise single line, no trailing period unless multi-sentence
- Examples from this repo:
  - `chore(deps): updated deps`
  - `feat: removed forwardRef from LangLink`
  - `chore: migration to @infonomic/uikit 6 and TypeScript 6`
  - `feat: nest field data under document 'fields' property`
