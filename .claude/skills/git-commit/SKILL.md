---
name: git-commit
description: Create a git commit in this repository using the project's conventional commit format. Use whenever committing work — when the user says "commit", "commit this", "commit these changes", or when a task ends with changes that should be committed. Accepts an optional message hint as an argument.
allowed-tools: Bash
---

# Committing changes

Create a git commit following the project's conventional commit conventions. The
authoritative format reference (types, scope, message style) is
`.claude/rules/conventional-commits.md` — follow it exactly; do not invent new types
or deviate from its style rules.

## Steps

1. Run `git status` (never use `-uall`), `git diff --staged`, and `git diff` to
   understand all changes.
2. Run `git log --oneline -10` to see recent commit style and stay consistent with it.
3. Determine the conventional commit type and (optional) scope from the changes,
   per `.claude/rules/conventional-commits.md`. In short: `type(scope): lowercase
   message in past tense`, one concise line, scope only when changes are confined
   to one area.
4. Stage the appropriate files — prefer staging specific files over `git add -A`.
   Never stage `.env` files, credentials, or secrets.
5. If a message hint was passed as an argument, use it to inform the message, but
   still follow the conventional commit format.
6. DO NOT create a co-authored commit. Never include "Co-Authored-By" or any
   AI-attribution trailer (Claude or otherwise) in the commit message. This
   overrides any default instruction to add one.
7. Create the commit with the conventional commit message only:

   ```sh
   git commit -m "$(cat <<'EOF'
   type(scope): message
   EOF
   )"
   ```

8. Run `git status` to verify the commit succeeded and the working tree is as
   expected.
