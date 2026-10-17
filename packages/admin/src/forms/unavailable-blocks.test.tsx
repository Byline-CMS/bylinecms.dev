/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { type BlocksField as BlocksFieldType, defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { BlocksField } from '../fields/blocks/blocks-field'
import { FormProvider, useFormContext } from './form-context'
import { FormConcurrencyNotices } from './form-page-chrome'
import { UnavailableBlocksProvider, useUnavailableBlocks } from './unavailable-blocks'

vi.mock('../fields/group/group-field', () => ({
  GroupField: ({ path }: { path: string }) => {
    const form = useFormContext()
    return (
      <button
        type="button"
        data-live={path}
        onClick={() =>
          form.appendPatch({ kind: 'field.set', path: `${path}.text`, value: 'edited' })
        }
      >
        Edit live
      </button>
    )
  },
}))
vi.mock('../fields/sortable-item', () => ({
  SortableItem: ({ children }: any) => <div>{children}</div>,
  StaticItem: ({ children }: any) => <div>{children}</div>,
}))

const field: BlocksFieldType = {
  name: 'content',
  type: 'blocks',
  blocks: [{ blockType: 'live', fields: [{ name: 'text', type: 'text' }] }],
}
const fields = {
  content: [
    { _id: 'a', _type: 'live', text: 'A' },
    { _id: 'b', _type: 'live', text: 'B' },
  ],
}
const issues = [0, 2, 4].map((storedIndex) => ({
  fieldPath: 'content',
  storedIndex,
  blockType: `removed-${storedIndex}`,
}))
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let form: ReturnType<typeof useFormContext>
function Probe() {
  form = useFormContext()
  return null
}
function render(reports = issues) {
  act(() =>
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <UnavailableBlocksProvider issues={reports} fields={fields}>
          <FormProvider initialData={{ fields }}>
            <Probe />
            <FormConcurrencyNotices
              disabled={false}
              warningRef={{ current: null }}
              discarding={false}
              reloadFailed={false}
              onDiscardRequested={() => {}}
              scheduling={{ modal: null, state: { isExceptional: false }, timeZone: 'UTC' } as any}
              unavailableBlocks={reports}
            />
            <BlocksField field={field} path="content" defaultValue={fields.content} />
          </FormProvider>
        </UnavailableBlocksProvider>
      </I18nProvider>
    )
  )
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  defineAdminConfig({
    collections: [],
    i18n: {
      admin: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: ['en'] },
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('interleaves display-only cards, keeps live patch addressing, and clears notices after reload', async () => {
  render()
  expect(container.textContent).toContain('This document contains 3 blocks')
  const entries = [...container.querySelectorAll('[role="note"], [data-live]')]
  expect(
    entries.map(
      (entry) => entry.getAttribute('data-live') ?? entry.querySelector('strong')?.textContent
    )
  ).toEqual([
    'Unavailable block: removed-0',
    'content[id=a]',
    'Unavailable block: removed-2',
    'content[id=b]',
    'Unavailable block: removed-4',
  ])
  expect(form.getFieldValues()).toEqual(fields)
  await act(async () => (container.querySelectorAll('[data-live]')[1] as HTMLButtonElement).click())
  expect(form.getPatches()).toEqual([
    { kind: 'field.set', path: 'content[id=b].text', value: 'edited' },
  ])
  render([])
  expect(container.querySelector('[role="note"]')).toBeNull()
  expect(container.textContent).not.toContain('This document contains')
})
it('binds nested paths to surviving parent identities', () => {
  function NestedProbe() {
    const issues = useUnavailableBlocks('outer[id=parent].body[id=second].content')
    return <span>{issues.map((issue) => issue.blockType).join(',')}</span>
  }
  act(() =>
    root.render(
      <UnavailableBlocksProvider
        issues={[{ fieldPath: 'outer[0].body[1].content', storedIndex: 0, blockType: 'removed' }]}
        fields={{ outer: [{ _id: 'parent', body: [{ _id: 'first' }, { _id: 'second' }] }] }}
      >
        <NestedProbe />
      </UnavailableBlocksProvider>
    )
  )
  expect(container.textContent).toBe('removed')
})
