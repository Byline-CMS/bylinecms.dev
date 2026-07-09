/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Drop the body's leading H1 when its text matches the frontmatter
 * `title`. Frontmatter is the source of truth for the page title; if
 * the body also opens with the same H1 the rendered doc would display
 * the title twice.
 *
 * The match is case-insensitive and ignores surrounding whitespace, so
 * minor presentation differences ("Authn / Authz" vs "authn / authz")
 * don't leak a duplicate heading. Anything else — a different H1, a
 * leading H2, no leading heading at all — is left untouched.
 */

import type { Root } from 'mdast'
import { toString as mdastToString } from 'mdast-util-to-string'

export function stripLeadingH1IfMatches(root: Root, title: string): Root {
  const first = root.children[0]
  if (first?.type !== 'heading' || first.depth !== 1) return root
  const headingText = mdastToString(first).trim().toLowerCase()
  const wanted = title.trim().toLowerCase()
  if (headingText !== wanted) return root
  return { ...root, children: root.children.slice(1) }
}
