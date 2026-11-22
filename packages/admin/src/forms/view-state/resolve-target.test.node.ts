/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// @vitest-environment jsdom
// A hand-built DOM, not a rendered form: the node suite runs it under jsdom.

import { describe, expect, it } from 'vitest'

import { findExactControl, isExactControlPending, resolveRestoreTarget } from './resolve-target'

/**
 * A hand-built editor form: a heading, a tab set whose `content` tab is
 * active (`seo` holds `seoTitle`, which is not rendered), a text field and a
 * blocks field with one expanded and one collapsed item.
 */
function buildForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form>
      <h1 class="byline-form-heading" tabindex="-1">Doc</h1>
      <div class="byline-form-tabset" data-byline-tabset-fields="title content seoTitle">
        <div role="tablist">
          <button type="button" role="tab" aria-selected="true" tabindex="0">Content</button>
          <button type="button" role="tab" aria-selected="false" tabindex="-1">SEO</button>
        </div>
        <div role="tabpanel">
          <div data-byline-target="title" data-byline-role="field">
            <label>Title</label><input name="title" />
          </div>
          <div data-byline-target="content" data-byline-role="field">
            <div class="byline-sortable">
              <div class="byline-sortable-header">
                <button type="button" data-byline-target="content[id=a]" data-byline-role="grip" id="grip-a"></button>
                <button type="button" data-byline-target="content[id=a]" data-byline-role="menu"></button>
                <button type="button" data-byline-target="content[id=a]" data-byline-role="toggle" id="toggle-a"></button>
              </div>
              <div class="byline-sortable-content">
                <div data-byline-target="content[id=a].heading" data-byline-role="field">
                  <input name="heading" id="heading-a" />
                </div>
                <div data-byline-target="content[id=a].body" data-byline-role="field" tabindex="-1" id="rich-a">
                  <div contenteditable="true" id="rich-a-root"></div>
                </div>
                <div data-byline-target="content[id=a].locked" data-byline-role="field">
                  <input name="locked" disabled />
                </div>
              </div>
            </div>
            <div class="byline-sortable">
              <div class="byline-sortable-header">
                <button type="button" data-byline-target="content[id=b]" data-byline-role="grip" id="grip-b"></button>
                <button type="button" data-byline-target="content[id=b]" data-byline-role="toggle" id="toggle-b"></button>
              </div>
              <div class="byline-sortable-content byline-sortable-content-hidden">
                <div data-byline-target="content[id=b].heading" data-byline-role="field">
                  <input name="heading" id="heading-b" />
                </div>
              </div>
            </div>
            <div class="byline-sortable">
              <div class="byline-sortable-header">
                <button type="button" data-byline-target="content[id=c]" data-byline-role="grip" id="grip-c"></button>
                <button type="button" data-byline-target="content[id=c]" data-byline-role="toggle" id="toggle-c" disabled></button>
              </div>
              <div class="byline-sortable-content">
                <div inert>
                  <div data-byline-target="content[id=c].heading" data-byline-role="field">
                    <input name="heading" id="heading-c" />
                  </div>
                </div>
              </div>
            </div>
            <button type="button" data-byline-target="content" data-byline-role="action:add" id="add-content"></button>
          </div>
        </div>
      </div>
    </form>`
  return document.querySelector('form') as HTMLFormElement
}

const byId = (form: HTMLFormElement, id: string) => form.querySelector(`#${id}`)

describe('resolveRestoreTarget', () => {
  it('level 1: resolves the exact control inside the field marker', () => {
    const form = buildForm()
    const target = { path: 'content[id=a].heading', role: 'field' as const, offset: 100 }
    expect(findExactControl(form, target)).toBe(byId(form, 'heading-a'))
    expect(resolveRestoreTarget(form, target)).toBe(byId(form, 'heading-a'))
  })

  it('level 1: resolves an item header control by role', () => {
    const form = buildForm()
    expect(resolveRestoreTarget(form, { path: 'content[id=a]', role: 'grip', offset: 0 })).toBe(
      byId(form, 'grip-a')
    )
    expect(resolveRestoreTarget(form, { path: 'content', role: 'action:add', offset: null })).toBe(
      byId(form, 'add-content')
    )
  })

  it('a rich-text target resolves to its focusable wrapper, never the content-editable root', () => {
    const form = buildForm()
    const resolved = resolveRestoreTarget(form, {
      path: 'content[id=a].body',
      role: 'field',
      offset: 10,
    })
    expect(resolved).toBe(byId(form, 'rich-a'))
    expect(resolved).not.toBe(byId(form, 'rich-a-root'))
  })

  it('a target inside collapsed content falls back to the item toggle', () => {
    const form = buildForm()
    const target = { path: 'content[id=b].heading', role: 'field' as const, offset: 100 }
    expect(findExactControl(form, target)).toBeNull()
    expect(resolveRestoreTarget(form, target)).toBe(byId(form, 'toggle-b'))
  })

  it('level 2: an inert target whose toggle is disabled falls back to the grip', () => {
    const form = buildForm()
    const target = { path: 'content[id=c].heading', role: 'field' as const, offset: 100 }
    expect(findExactControl(form, target)).toBeNull()
    expect(resolveRestoreTarget(form, target)).toBe(byId(form, 'grip-c'))
  })

  it('level 2: a disabled control falls back to its item toggle', () => {
    const form = buildForm()
    const target = { path: 'content[id=a].locked', role: 'field' as const, offset: 100 }
    expect(findExactControl(form, target)).toBeNull()
    expect(resolveRestoreTarget(form, target)).toBe(byId(form, 'toggle-a'))
  })

  it('level 3: a target whose item is gone falls back to the repeating field’s own add control, never a neighbour item', () => {
    const form = buildForm()
    // The removed item `z` has no header; its parent field is the nearest marker.
    const target = { path: 'content[id=z].heading', role: 'field' as const, offset: 100 }
    expect(resolveRestoreTarget(form, target)).toBe(byId(form, 'add-content'))
  })

  it('a positional target resolves to its identifiable parent', () => {
    const form = buildForm()
    const target = { path: 'content[2].heading', role: 'field' as const, offset: 100 }
    // Cut at `[2]`, the trusted address is `content`: never the item that
    // currently happens to sit at index 2, nor any other item's controls.
    expect(findExactControl(form, target)).toBeNull()
    expect(resolveRestoreTarget(form, target)).toBe(byId(form, 'add-content'))
  })

  it('a repeating field without a usable add control falls back to the heading, not a neighbour item', () => {
    const form = buildForm()
    byId(form, 'add-content')?.setAttribute('disabled', '')
    const resolved = resolveRestoreTarget(form, {
      path: 'content[id=z].heading',
      role: 'field',
      offset: 100,
    })
    // `content` sits in the tab set, so the active trigger comes before the heading.
    expect(resolved.getAttribute('role')).toBe('tab')
    expect(resolved.closest('.byline-sortable')).toBeNull()
  })

  it('nested identified ancestors: a gone inner item falls back to its own ancestors’ controls, never a sibling’s', () => {
    document.body.innerHTML = `<form>
      <h1 class="byline-form-heading" tabindex="-1">Doc</h1>
      <div data-byline-target="blocks" data-byline-role="field">
        <div class="byline-sortable">
          <div class="byline-sortable-header">
            <button type="button" data-byline-target="blocks[id=o]" data-byline-role="grip" id="grip-o" disabled></button>
            <button type="button" data-byline-target="blocks[id=o]" data-byline-role="toggle" id="toggle-o" disabled></button>
          </div>
          <div class="byline-sortable-content">
            <div data-byline-target="blocks[id=o].list" data-byline-role="field">
              <div class="byline-sortable">
                <div class="byline-sortable-header">
                  <button type="button" data-byline-target="blocks[id=o].list[id=y]" data-byline-role="grip" id="grip-y"></button>
                  <button type="button" data-byline-target="blocks[id=o].list[id=y]" data-byline-role="toggle" id="toggle-y"></button>
                </div>
                <div class="byline-sortable-content">
                  <div data-byline-target="blocks[id=o].list[id=y].t" data-byline-role="field"><input id="t-y" /></div>
                </div>
              </div>
              <button type="button" data-byline-target="blocks[id=o].list" data-byline-role="action:add" id="add-list"></button>
            </div>
          </div>
        </div>
        <div class="byline-sortable">
          <div class="byline-sortable-header">
            <button type="button" data-byline-target="blocks[id=p]" data-byline-role="grip" id="grip-p"></button>
          </div>
        </div>
        <button type="button" data-byline-target="blocks" data-byline-role="action:add" id="add-blocks"></button>
      </div>
    </form>`
    const form = document.querySelector('form') as HTMLFormElement
    const target = { path: 'blocks[id=o].list[id=x].t', role: 'field' as const, offset: 0 }
    // Level 2: the containing outer item's own toggle.
    form.querySelector('#toggle-o')?.removeAttribute('disabled')
    expect(resolveRestoreTarget(form, target)).toBe(form.querySelector('#toggle-o'))
    form.querySelector('#toggle-o')?.setAttribute('disabled', '')
    // Outer item `o`'s own header controls are disabled here, so the inner
    // list's own add control is next; sibling `y` and sibling `p` never win.
    expect(resolveRestoreTarget(form, target)).toBe(form.querySelector('#add-list'))
    form.querySelector('#add-list')?.setAttribute('disabled', '')
    expect(resolveRestoreTarget(form, target)).toBe(form.querySelector('#add-blocks'))
  })

  it('a target under an unselected tab falls back to the active tab trigger', () => {
    const form = buildForm()
    const target = { path: 'seoTitle', role: 'field' as const, offset: 100 }
    const resolved = resolveRestoreTarget(form, target)
    expect(resolved?.getAttribute('role')).toBe('tab')
    expect(resolved?.getAttribute('aria-selected')).toBe('true')
  })

  it('level 5: an unknown target falls back to the heading', () => {
    const form = buildForm()
    const resolved = resolveRestoreTarget(form, { path: 'nowhere', role: 'field', offset: 0 })
    expect(resolved).toBe(form.querySelector('.byline-form-heading'))
  })

  it('an untrusted (leading positional) address falls back to the heading', () => {
    const form = buildForm()
    const resolved = resolveRestoreTarget(form, { path: '[0].x', role: 'field', offset: 0 })
    expect(resolved).toBe(form.querySelector('.byline-form-heading'))
  })

  it('the exact control is the field’s value-entry control, not a button before it', () => {
    document.body.innerHTML = `<form>
      <h1 class="byline-form-heading" tabindex="-1">Doc</h1>
      <div data-byline-target="$path" data-byline-role="field">
        <button type="button" id="regenerate">Regenerate</button>
        <input name="__systemPath__" id="path-input" />
      </div>
    </form>`
    const form = document.querySelector('form') as HTMLFormElement
    expect(resolveRestoreTarget(form, { path: '$path', role: 'field', offset: 0 })).toBe(
      form.querySelector('#path-input')
    )
  })

  it('a field whose control is still loading has no exact control and is pending', () => {
    document.body.innerHTML = `<form>
      <h1 class="byline-form-heading" tabindex="-1">Doc</h1>
      <div data-byline-target="snippet" data-byline-role="field">
        <label>Snippet</label>
        <textarea readonly data-byline-loading id="loading"></textarea>
      </div>
    </form>`
    const form = document.querySelector('form') as HTMLFormElement
    const target = { path: 'snippet', role: 'field' as const, offset: 0 }
    expect(findExactControl(form, target)).toBeNull()
    expect(isExactControlPending(form, target)).toBe(true)
    // When the bound runs out, the loading placeholder is never the fallback.
    expect(resolveRestoreTarget(form, target)).toBe(form.querySelector('.byline-form-heading'))
  })
})
