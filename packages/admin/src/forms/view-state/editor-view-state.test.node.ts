/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { createEditorViewStateStore } from './editor-view-state'

const target = { path: 'title', role: 'field', offset: 120 } as const

describe('editor view state store', () => {
  it('tabs and collapse round-trip', () => {
    const s = createEditorViewStateStore()
    s.setTab('main', 'content')
    expect(s.getTab('main')).toBe('content')
    s.setCollapsed('content[id=a]', true)
    expect(s.isCollapsed('content[id=a]')).toBe(true)
    s.setCollapsed('content[id=a]', false)
    expect(s.isCollapsed('content[id=a]')).toBe(false)
  })

  it('collapse under a positional address is ignored', () => {
    const s = createEditorViewStateStore()
    s.setCollapsed('content[1]', true)
    expect(s.isCollapsed('content[1]')).toBe(false)
  })

  it('a refused save leaves nothing pending', () => {
    const s = createEditorViewStateStore()
    const n = s.beginSave()
    s.settleSave(n, 'refused')
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('a successful save yields one restoration', () => {
    const s = createEditorViewStateStore()
    s.setTarget({ ...target })
    const n = s.beginSave()
    s.setTarget({ path: 'other', role: 'field', offset: 1 })
    s.settleSave(n, 'success')
    expect(s.takePendingRestore(undefined)).toEqual({
      saveSeq: n,
      target,
      focusWarning: false,
      expectedRevision: null,
    })
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('a warning belongs to its own save', () => {
    const s = createEditorViewStateStore()
    const a = s.beginSave()
    s.markSaveWarning()
    s.settleSave(a, 'success')
    expect(s.takePendingRestore(undefined)?.focusWarning).toBe(true)
    const b = s.beginSave()
    s.settleSave(b, 'success')
    expect(s.takePendingRestore(undefined)?.focusWarning).toBe(false)
  })

  it('cancelling discards a pending restoration', () => {
    const s = createEditorViewStateStore()
    s.settleSave(s.beginSave(), 'success')
    s.cancelPendingRestore()
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('restoration waits for the expected revision', () => {
    const s = createEditorViewStateStore()
    const n = s.beginSave()
    s.expectRefresh({ revision: 47 })
    s.settleSave(n, 'success')
    expect(s.takePendingRestore(46)).toBeNull()
    expect(s.takePendingRestore(undefined)).toBeNull()
    expect(s.takePendingRestore(47)?.expectedRevision).toBe(47)
    expect(s.takePendingRestore(47)).toBeNull()
  })

  it('no receipt means no revision gate', () => {
    const s = createEditorViewStateStore()
    s.settleSave(s.beginSave(), 'success')
    expect(s.takePendingRestore(undefined)?.expectedRevision).toBeNull()
  })

  it('a newer save supersedes a pending restoration', () => {
    const s = createEditorViewStateStore()
    const a = s.beginSave()
    const b = s.beginSave()
    s.settleSave(a, 'success')
    expect(s.takePendingRestore(undefined)).toBeNull()
    s.settleSave(b, 'success')
    expect(s.takePendingRestore(undefined)?.saveSeq).toBe(b)
  })

  it('collapse under an empty address is ignored', () => {
    const s = createEditorViewStateStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.setCollapsed('', true)
    expect(s.isCollapsed('')).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('settling a save notifies a subscriber that can then consume once', () => {
    const s = createEditorViewStateStore()
    const n = s.beginSave()
    const seen: Array<ReturnType<typeof s.takePendingRestore>> = []
    s.subscribe(() => seen.push(s.takePendingRestore(undefined)))
    s.settleSave(n, 'success')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.saveSeq).toBe(n)
    expect(s.takePendingRestore(undefined)).toBeNull()
  })

  it('a refused save does not notify', () => {
    const s = createEditorViewStateStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.settleSave(s.beginSave(), 'refused')
    expect(listener).not.toHaveBeenCalled()
  })

  describe('action restorations', () => {
    const action = {
      role: 'action:status' as const,
      fallbackRole: null,
      anchor: { path: 'title', role: 'field' as const, offset: 40 },
      fromLocale: 'en',
      toLocale: null,
      expectedRevision: null,
    }

    it('an action restoration is taken once, with a snapshot of the working target', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      const n = s.setActionRestore({ ...action })
      s.setTarget({ path: 'other', role: 'field', offset: 1 })
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toEqual({
        ...action,
        actionSeq: n,
        target,
      })
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toBeNull()
    })

    it('setting an action restoration notifies subscribers', () => {
      const s = createEditorViewStateStore()
      const listener = vi.fn()
      s.subscribe(listener)
      s.setActionRestore({ ...action })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('an action restoration waits for the expected revision', () => {
      const s = createEditorViewStateStore()
      s.setActionRestore({ ...action, expectedRevision: 8 })
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toBeNull()
      expect(s.takeActionRestore({ locale: 'en', revision: undefined })).toBeNull()
      expect(s.takeActionRestore({ locale: 'en', revision: 8 })?.expectedRevision).toBe(8)
    })

    it('an action restoration waits for the intended locale', () => {
      const s = createEditorViewStateStore()
      s.setActionRestore({ ...action, role: 'action:locale', toLocale: 'fr' })
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toBeNull()
      expect(s.takeActionRestore({ locale: 'fr', revision: 7 })?.role).toBe('action:locale')
    })

    it('recording a locale change clears nothing; consuming it clears the working target', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.setActionRestore({ ...action, role: 'action:locale', toLocale: 'fr' })
      expect(s.getTarget()).toEqual(target)
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toBeNull()
      expect(s.getTarget()).toEqual(target)
      const taken = s.takeActionRestore({ locale: 'fr', revision: 7 })
      expect(taken?.target).toBeNull()
      expect(s.getTarget()).toBeNull()
    })

    it('an action that lands on the same locale keeps the working target', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.setActionRestore({ ...action, role: 'action:delete-locale', toLocale: 'en' })
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })?.target).toEqual(target)
      expect(s.getTarget()).toEqual(target)
    })

    it('a newer action supersedes an earlier one', () => {
      const s = createEditorViewStateStore()
      s.setActionRestore({ ...action })
      const b = s.setActionRestore({ ...action, role: 'action:unpublish' })
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })?.actionSeq).toBe(b)
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toBeNull()
    })

    it('a save supersedes a pending action restoration, and an action supersedes a pending save', () => {
      const s = createEditorViewStateStore()
      s.setActionRestore({ ...action })
      s.settleSave(s.beginSave(), 'success')
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).toBeNull()

      const n = s.beginSave()
      s.setActionRestore({ ...action })
      s.settleSave(n, 'success')
      expect(s.takePendingRestore(undefined)).toBeNull()
      expect(s.takeActionRestore({ locale: 'en', revision: 7 })).not.toBeNull()
    })

    it('the action sequence number is known before subscribers are notified', () => {
      const s = createEditorViewStateStore()
      const seen: number[] = []
      let assigned = -1
      s.subscribe(() => seen.push(assigned))
      const n = s.setActionRestore({ ...action }, (seq) => {
        assigned = seq
      })
      expect(seen).toEqual([n])
    })

    it('cancelling discards a pending action restoration and keeps the working target', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.setActionRestore({ ...action, toLocale: 'fr' })
      s.cancelPendingRestore()
      expect(s.takeActionRestore({ locale: 'fr', revision: 7 })).toBeNull()
      expect(s.getTarget()).toEqual(target)
    })
  })

  describe('observed content locale', () => {
    it('the first observation keeps the working target', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.observeContentLocale('en')
      expect(s.getTarget()).toEqual(target)
    })

    it('observing the same locale again keeps the working target', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      s.setTarget({ ...target })
      s.observeContentLocale('en')
      expect(s.getTarget()).toEqual(target)
    })

    it('a different committed locale clears the working target, with no action restoration', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      s.setTarget({ ...target })
      s.observeContentLocale('fr')
      expect(s.getTarget()).toBeNull()
      // A target recorded in the new locale survives further observations of it.
      s.setTarget({ ...target })
      s.observeContentLocale('fr')
      expect(s.getTarget()).toEqual(target)
    })

    it('a cancelled locale-switch restoration still clears the target once the locale commits', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      s.setTarget({ ...target })
      s.setActionRestore({
        role: 'action:locale',
        fallbackRole: null,
        anchor: null,
        fromLocale: 'en',
        toLocale: 'fr',
        expectedRevision: null,
      })
      s.cancelPendingRestore()
      expect(s.getTarget()).toEqual(target)
      s.observeContentLocale('fr')
      expect(s.getTarget()).toBeNull()
    })
  })

  describe('committed locale change and prior-locale work', () => {
    const localeAction = (toLocale: string | null) => ({
      role: 'action:locale' as const,
      fallbackRole: null,
      anchor: null,
      fromLocale: 'en',
      toLocale,
      expectedRevision: null,
    })

    it('drops a pending save restoration recorded in the previous locale', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      s.setTarget({ ...target })
      const n = s.beginSave()
      s.expectRefresh({ revision: 8 })
      s.settleSave(n, 'success')
      expect(s.observeContentLocale('fr')).toBe(true)
      expect(s.takePendingRestore(8)).toBeNull()
    })

    it('an in-flight previous-locale save that settles after the switch creates nothing', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      const n = s.beginSave()
      s.observeContentLocale('fr')
      s.expectRefresh({ revision: 8 })
      s.settleSave(n, 'success')
      expect(s.takePendingRestore(8)).toBeNull()
    })

    it('keeps the matching locale transition and drops any other pending action', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      s.setActionRestore(localeAction('fr'))
      expect(s.observeContentLocale('fr')).toBe(true)
      expect(s.takeActionRestore({ locale: 'fr', revision: 7 })?.role).toBe('action:locale')

      s.setActionRestore({ ...localeAction(null), role: 'action:status' })
      expect(s.observeContentLocale('de')).toBe(true)
      expect(s.takeActionRestore({ locale: 'de', revision: 7 })).toBeNull()
    })

    it('reports no change when the locale is the same', () => {
      const s = createEditorViewStateStore()
      expect(s.observeContentLocale('en')).toBe(false)
      expect(s.observeContentLocale('en')).toBe(false)
    })
  })

  it('subscribe notifies on writes', () => {
    const s = createEditorViewStateStore()
    const listener = vi.fn()
    const off = s.subscribe(listener)
    s.setTab('main', 'x')
    s.setCollapsed('a[id=1]', true)
    s.setTarget({ ...target })
    expect(listener).toHaveBeenCalledTimes(3)
    off()
    s.setTab('main', 'y')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
