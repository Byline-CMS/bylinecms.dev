/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure reconciliation logic for the available-locales widget, kept React- and
 * CSS-free so it can be unit-tested in the node-mode admin suite (importing the
 * `.tsx` widget would drag in JSX + a CSS-module import the node runner can't
 * transform).
 */

/** Checkbox intent + interactivity for one reconciled locale row. */
export interface ReconciledLocaleState {
  intent: 'success' | 'warning' | 'noeffect'
  disabled: boolean
}

/**
 * Reconcile a locale's editorial state (`checked` — in the stored advertised
 * set) against the ledger fact (`complete` — in `_availableVersionLocales`)
 * into a checkbox intent + disabled flag. The reconciliation is expressed
 * entirely through colour/interactivity, with no per-row text:
 *
 *   complete                 → `success` (green),  enabled  — toggle on/off
 *   not complete, advertised → `warning` (amber),  enabled  — advertising an
 *       incomplete locale; the editor can uncheck to resolve the over-advert
 *   not complete, not advert → `noeffect` (gray),  disabled — nothing to do
 */
export function reconcileLocaleState(checked: boolean, complete: boolean): ReconciledLocaleState {
  if (complete) return { intent: 'success', disabled: false }
  if (checked) return { intent: 'warning', disabled: false }
  return { intent: 'noeffect', disabled: true }
}
