/** Normalize a template-relative path independently of the host platform. */
export function toPosixTemplatePath(path: string): string {
  return path.replaceAll('\\', '/')
}

/**
 * Templates shipped in 6.13 and earlier carried the older wording of the MPL 2.0
 * Exhibit A notice. Files a host installed from those templates must still be
 * recognized as unmodified, so both wordings compare as the current one.
 */
const LEGACY_MPL_NOTICE_LINES: ReadonlyArray<readonly [string, string]> = [
  [
    'This Source Code is subject to the terms of the Mozilla Public',
    'This Source Code Form is subject to the terms of the Mozilla Public',
  ],
  [
    'file, You can obtain one at http://mozilla.org/MPL/2.0/.',
    'file, You can obtain one at https://mozilla.org/MPL/2.0/.',
  ],
]

/** Source comparison used only for recognizing exact canonical predecessors. */
export function normalizeTemplateSource(source: string): string {
  let normalized = source.replaceAll('\r\n', '\n').trimEnd()
  for (const [legacy, current] of LEGACY_MPL_NOTICE_LINES) {
    normalized = normalized.replaceAll(legacy, current)
  }
  return normalized
}
