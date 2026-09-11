/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pre-upgrade scanning, without the editor.
 *
 * This entry is deliberately **runtime-free**: it carries the pure
 * scanning logic and its types, and imports no React, no Lexical
 * extension and no CSS. A Node script can therefore read it, which the
 * root barrel makes impossible — importing that pulls the editor graph
 * and fails on the first `.css` import.
 *
 * The other half, measuring what a field accepts, needs a DOM and lives
 * on the root entry as `capabilitiesFor` / `capabilitiesFromEditor`.
 * That split is the same boundary the manifest crosses: capabilities are
 * measured in a browser, written to a file, and consumed here.
 *
 * See docs/09-admin-ui/04-richtext-capabilities.md.
 */

export { scanDocument, summarise } from './scan/scan-documents'
export type { CapabilityManifest, FieldCapabilities, ScanFinding } from './scan/types'
