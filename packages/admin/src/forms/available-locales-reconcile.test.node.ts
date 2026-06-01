/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { reconcileLocaleState } from './available-locales-reconcile.js'

/**
 * The widget's reconciliation is expressed purely as Checkbox intent +
 * disabled state — no per-row text. `reconcileLocaleState` is the pure heart
 * of that mapping; the four cells below are the full truth table from
 * docs/I18N.md.
 */
describe('reconcileLocaleState', () => {
  it('ledger-complete + advertised → green, enabled (advertised & complete)', () => {
    expect(reconcileLocaleState(true, true)).toEqual({ intent: 'success', disabled: false })
  })

  it('ledger-complete + not advertised → green, enabled (invitation to advertise)', () => {
    expect(reconcileLocaleState(false, true)).toEqual({ intent: 'success', disabled: false })
  })

  it('not complete + advertised → amber, enabled (advertising an incomplete locale)', () => {
    // The ⚠ row: surfaced as `warning` and kept enabled so the editor can
    // uncheck to resolve the over-advertisement.
    expect(reconcileLocaleState(true, false)).toEqual({ intent: 'warning', disabled: false })
  })

  it('not complete + not advertised → gray, disabled (nothing to advertise)', () => {
    expect(reconcileLocaleState(false, false)).toEqual({ intent: 'noeffect', disabled: true })
  })

  it('completeness drives green regardless of advertised state', () => {
    // The ledger fact wins the colour when complete; only the disabled/amber
    // distinction depends on the advertised flag.
    expect(reconcileLocaleState(true, true).intent).toBe('success')
    expect(reconcileLocaleState(false, true).intent).toBe('success')
  })

  it('only the not-complete + not-advertised cell is non-interactive', () => {
    expect(reconcileLocaleState(true, true).disabled).toBe(false)
    expect(reconcileLocaleState(false, true).disabled).toBe(false)
    expect(reconcileLocaleState(true, false).disabled).toBe(false)
    expect(reconcileLocaleState(false, false).disabled).toBe(true)
  })
})
