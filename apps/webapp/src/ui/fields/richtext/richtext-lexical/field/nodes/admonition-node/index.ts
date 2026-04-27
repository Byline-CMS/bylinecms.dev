/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export * from './admonition-node'
// Intentionally NOT re-exported: `admonition-node-component` is loaded
// lazily via `React.lazy` inside `admonition-node.tsx` so it can land in
// its own chunk. Re-exporting it here would static-import it back into
// any consumer of this barrel and defeat the split.
export * from './types'
