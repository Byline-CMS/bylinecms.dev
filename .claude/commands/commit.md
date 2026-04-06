---
name: commit
description: Stage and commit changes using conventional commit format. Pass an optional message hint.
allowed-tools: Bash
argument-hint: [optional message hint]
---

Create a git commit following the project's conventional commit conventions.

## Steps

1. Run `git status` (never use `-uall`) and `git diff --staged` and `git diff` to understand all changes.
2. Run `git log --oneline -10` to see recent commit style.
3. Determine the appropriate conventional commit type and scope from the changes:

### Commit types
- `feat:` — new feature or significant enhancement
- `fix:` — bug fix
- `chore:` — maintenance that doesn't change runtime behaviour
- `chore(deps):` — dependency updates
- `refactor:` — code restructuring without behaviour change
- `docs:` — documentation only
- `test:` — adding or updating tests
- `style:` — formatting, whitespace (not CSS changes — those are feat/fix)
- `ci:` — CI/CD pipeline changes
- `perf:` — performance improvements

### Scope (optional, in parentheses)
Use a scope when changes are clearly confined to one area, e.g. `feat(search):`, `fix(i18n):`, `chore(deps):`. Omit scope for cross-cutting changes.

### Message style (match existing history)
- Lowercase after the colon: `feat: added new hero component`
- Past tense preferred: "updated", "added", "fixed", "removed"
- Concise — one line, no period at end unless multi-sentence

4. Stage the appropriate files (prefer specific files over `git add -A`). Do not stage `.env` files, credentials, or secrets.
5. If `$ARGUMENTS` is provided, use it as a hint for the message but still follow the format above.
6. Create the commit with the conventional commit message only:

```
git commit -m "$(cat <<'EOF'
type(scope): message
EOF
)"
```

7. Run `git status` to verify success.
