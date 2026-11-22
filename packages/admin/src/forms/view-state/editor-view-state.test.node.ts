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

  describe('caret and selection', () => {
    const richRange = {
      kind: 'richText' as const,
      sel: { anchor: { path: [0, 0], offset: 5 }, focus: { path: [0, 0], offset: 5 } },
    }
    const richSel = { ...richRange, fingerprint: () => 'abc' }
    const textRange = { kind: 'text' as const, start: 3, end: 3, direction: 'none' as const }
    const textSel = { ...textRange, fingerprint: () => 'f00' }

    /** Records `selection` for the working target, saves successfully and returns the save. */
    const savedWith = (selection: typeof richSel | typeof textSel) => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.setSelection('title', selection)
      const n = s.beginSave()
      s.settleSave(n, 'success')
      return { s, n }
    }

    it('is taken once, only after the save restoration grants it for the target', () => {
      const { s, n } = savedWith(richSel)
      expect(s.takeSelection('title')).toBeNull()
      expect(s.grantSelection(n, 'title')).not.toBeNull()
      expect(s.takeSelection('other')).toBeNull()
      expect(s.takeSelection('title')).toEqual({ ...richRange, fingerprint: 'abc' })
      expect(s.takeSelection('title')).toBeNull()
    })

    it('fingerprints the content once, when the save begins, and never before', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      const fingerprint = vi.fn(() => 'abc')
      s.setSelection('title', { ...richRange, fingerprint })
      s.setSelection('title', { ...richRange, fingerprint })
      expect(fingerprint).not.toHaveBeenCalled()
      const n = s.beginSave()
      expect(fingerprint).toHaveBeenCalledTimes(1)
      s.settleSave(n, 'success')
      s.grantSelection(n, 'title')
      expect(s.takeSelection('title')?.fingerprint).toBe('abc')
      expect(fingerprint).toHaveBeenCalledTimes(1)
    })

    it('content that cannot be fingerprinted is not replayed', () => {
      for (const fingerprint of [
        () => null,
        () => {
          throw new Error('editor gone')
        },
      ]) {
        const s = createEditorViewStateStore()
        s.setTarget({ ...target })
        s.setSelection('title', { ...richRange, fingerprint })
        const n = s.beginSave()
        s.settleSave(n, 'success')
        expect(s.grantSelection(n, 'title')).toBeNull()
      }
    })

    it('a granted selection notifies subscribers on a later microtask', async () => {
      const { s, n } = savedWith(richSel)
      const listener = vi.fn()
      s.subscribe(listener)
      s.grantSelection(n, 'title')
      expect(listener).not.toHaveBeenCalled()
      await Promise.resolve()
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('carries a plain-field selection the same way', () => {
      const { s, n } = savedWith(textSel)
      s.grantSelection(n, 'title')
      expect(s.takeSelection('title')).toEqual({ ...textRange, fingerprint: 'f00' })
    })

    it('ignores a selection for a path that is not the working target', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.setSelection('other', richSel)
      const n = s.beginSave()
      s.settleSave(n, 'success')
      expect(s.grantSelection(n, 'other')).toBeNull()
      expect(s.takeSelection('other')).toBeNull()
    })

    it('recording the same working target again keeps the selection; another target clears it', () => {
      // A delayed change callback from the same edit records the same target.
      const same = createEditorViewStateStore()
      same.setTarget({ ...target })
      same.setSelection('title', richSel)
      same.setTarget({ ...target, offset: 40 })
      const n = same.beginSave()
      same.settleSave(n, 'success')
      expect(same.grantSelection(n, 'title')).not.toBeNull()

      for (const next of [
        { ...target, path: 'other' },
        { ...target, role: 'toggle' as const },
      ]) {
        const s = createEditorViewStateStore()
        s.setTarget({ ...target })
        s.setSelection('title', richSel)
        s.setTarget(next)
        s.setTarget({ ...target })
        const m = s.beginSave()
        s.settleSave(m, 'success')
        expect(s.grantSelection(m, 'title')).toBeNull()
      }
    })

    it('clearing the selection of the target drops it; another path is unaffected', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      s.setSelection('title', richSel)
      s.clearSelection('other')
      s.clearSelection('title')
      const n = s.beginSave()
      s.settleSave(n, 'success')
      expect(s.grantSelection(n, 'title')).toBeNull()

      const kept = createEditorViewStateStore()
      kept.setTarget({ ...target })
      kept.setSelection('title', richSel)
      kept.clearSelection('other')
      const m = kept.beginSave()
      kept.settleSave(m, 'success')
      expect(kept.grantSelection(m, 'title')).not.toBeNull()
    })

    it('a grant belongs to its own save', () => {
      const { s, n } = savedWith(richSel)
      expect(s.grantSelection(n + 1, 'title')).toBeNull()
      expect(s.grantSelection(n, 'other')).toBeNull()
    })

    it('the selection recorded after the save began is not replayed', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      const n = s.beginSave()
      s.setSelection('title', richSel)
      s.settleSave(n, 'success')
      expect(s.grantSelection(n, 'title')).toBeNull()
    })

    it('revoking ends only the grant it names', () => {
      const { s, n } = savedWith(richSel)
      const grant = s.grantSelection(n, 'title')
      if (grant == null) throw new Error('no grant')
      s.revokeSelection(grant + 1)
      expect(s.takeSelection('title')).toEqual({ ...richRange, fingerprint: 'abc' })

      const second = savedWith(richSel)
      const id = second.s.grantSelection(second.n, 'title')
      if (id == null) throw new Error('no grant')
      second.s.revokeSelection(id)
      expect(second.s.takeSelection('title')).toBeNull()
    })

    it('moving on, a newer save or an action discards a granted selection', () => {
      for (const supersede of [
        (s: ReturnType<typeof createEditorViewStateStore>) => s.cancelPendingRestore(),
        (s: ReturnType<typeof createEditorViewStateStore>) => s.beginSave(),
        (s: ReturnType<typeof createEditorViewStateStore>) =>
          s.setActionRestore({
            role: 'action:status',
            fallbackRole: null,
            anchor: null,
            fromLocale: null,
            toLocale: null,
            expectedRevision: null,
          }),
      ]) {
        const { s, n } = savedWith(richSel)
        s.grantSelection(n, 'title')
        supersede(s)
        expect(s.takeSelection('title')).toBeNull()
      }
    })

    it('a committed locale change clears the recorded and the granted selection', () => {
      const s = createEditorViewStateStore()
      s.observeContentLocale('en')
      s.setTarget({ ...target })
      s.setSelection('title', richSel)
      const n = s.beginSave()
      s.settleSave(n, 'success')
      s.grantSelection(n, 'title')
      s.observeContentLocale('fr')
      expect(s.takeSelection('title')).toBeNull()
    })

    describe('releasing a live selection when its producer unmounts', () => {
      it('releases only the selection the owner recorded, without calling its fingerprint', () => {
        const s = createEditorViewStateStore()
        s.setTarget({ ...target })
        const owner = {}
        const fingerprint = vi.fn(() => 'abc')
        s.setSelection('title', { ...richRange, fingerprint }, owner)
        s.releaseSelection(owner)
        const n = s.beginSave()
        s.settleSave(n, 'success')
        expect(fingerprint).not.toHaveBeenCalled()
        expect(s.grantSelection(n, 'title')).toBeNull()
      })

      it("an older owner's release keeps a newer owner's selection", () => {
        const s = createEditorViewStateStore()
        s.setTarget({ ...target })
        const older = {}
        const newer = {}
        s.setSelection('title', richSel, older)
        s.setSelection('title', { ...richSel, fingerprint: () => 'new' }, newer)
        s.releaseSelection(older)
        const n = s.beginSave()
        s.settleSave(n, 'success')
        expect(s.grantSelection(n, 'title')).not.toBeNull()
        expect(s.takeSelection('title')).toEqual({ ...richRange, fingerprint: 'new' })
      })

      it('a selection a save already snapshotted survives the release', () => {
        const s = createEditorViewStateStore()
        s.setTarget({ ...target })
        const owner = {}
        s.setSelection('title', richSel, owner)
        const n = s.beginSave()
        s.releaseSelection(owner)
        s.settleSave(n, 'success')
        expect(s.grantSelection(n, 'title')).not.toBeNull()
        expect(s.takeSelection('title')).toEqual({ ...richRange, fingerprint: 'abc' })
      })
    })

    it('recording a selection does not notify subscribers', () => {
      const s = createEditorViewStateStore()
      s.setTarget({ ...target })
      const listener = vi.fn()
      s.subscribe(listener)
      s.setSelection('title', richSel)
      expect(listener).not.toHaveBeenCalled()
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
