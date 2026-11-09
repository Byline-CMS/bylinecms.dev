/**
 * Fingerprints of every value Byline's canonical `vite.config.ts` has held for
 * the keys Byline manages in a host config.
 *
 * `byline init` replaces a managed value automatically only when the host's
 * value is Byline's current one or matches a fingerprint listed here — that
 * is, when an earlier release wrote it verbatim. Any other value has been
 * changed by the host and is left untouched, so host additions such as an
 * extra Nitro external are never silently dropped.
 *
 * Fingerprints come from `fingerprintValue()` in `vite-config-merge.ts`: the
 * value's syntax tree without comments, whitespace, quote style or trailing
 * commas. Each entry names the template commit that first shipped the value.
 *
 * When you change a managed value in `templates/host/vite.config.ts`, the
 * contract test in `vite-config-merge.test.ts` fails. Move the key's old
 * fingerprint from `CURRENT_MANAGED_VALUES` into this list, and record the new
 * one there.
 */

/** A Byline-managed key in a host `vite.config.ts`; `nitro.` keys sit in the `nitro({...})` call. */
export type ManagedKey =
  | 'environments'
  | 'ssr'
  | 'optimizeDeps'
  | 'nitro.noExternals'
  | 'nitro.rolldownConfig'
  | 'nitro.features'

export const KNOWN_MANAGED_VALUES: Readonly<Record<ManagedKey, readonly string[]>> = {
  environments: [
    'b391f04a8768da3d', // ca756eba 2026-05-04
    '7212c4d354863c26', // 4480ec21 2026-05-05
    '804a50f00ba4a608', // d89c63db 2026-05-05
    'fe6849ad53880b6f', // b5a771ab 2026-05-05
    '4c491439ccff077c', // e0e4cb8e 2026-05-18
    '60567e6cb34b5e26', // 74214970 2026-06-13
  ],
  ssr: [
    '4d5fff8b081c0af8', // 8f1b250d 2026-05-04
  ],
  optimizeDeps: [
    '38a7b8b3963c2d94', // 8f1b250d 2026-05-04
    '64eccb3ce1e0c72e', // ca756eba 2026-05-04
  ],
  'nitro.noExternals': [
    '77049b458ee9a15d', // ca756eba 2026-05-04
  ],
  'nitro.rolldownConfig': [
    '8e10d8e9d8129d4c', // d89c63db 2026-05-05
    '97e7093cd35ec77d', // f711e27f 2026-05-22
    '5167f45021036e10', // eccf2efd 2026-05-23
  ],
  'nitro.features': [],
}

/**
 * Fingerprints of the current canonical values, pinned so that changing one
 * fails a test until its previous fingerprint is added to the known list.
 */
export const CURRENT_MANAGED_VALUES: Readonly<Record<ManagedKey, string>> = {
  environments: 'c6c2d8551a3deceb',
  ssr: 'cc13e6456f315cde',
  optimizeDeps: 'd6735dd480e8b5de',
  'nitro.noExternals': 'ca65f9d7f863e1b4',
  'nitro.rolldownConfig': '75d7e4182c816520',
  'nitro.features': 'f10af2cc672233dc',
}
