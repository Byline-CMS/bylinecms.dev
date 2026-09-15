/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act, useLayoutEffect } from 'react'

import { defineAdminConfig, type Field } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FieldRenderer } from '../fields/field-renderer'
import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { TextField } from '../fields/text/text-field'
import { useFieldChangeHandler } from '../fields/use-field-change-handler'
import { useFieldCondition } from '../fields/use-field-condition'
import { FormProvider, useFieldValue, useFormContext } from './form-context'
import { type UseFormSubmissionResult, useFormSubmission } from './use-form-submission'
import { useFormTabs } from './use-form-tabs'

const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [
    {
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    },
  ],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

const fields = [{ name: 'title', label: 'Title', type: 'text' as const }]

const deferred = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

interface Harness {
  result: UseFormSubmissionResult
  ctx: ReturnType<typeof useFormContext>
}

const renderHookInForm = (
  options: Partial<Parameters<typeof useFormSubmission>[0]> = {},
  { uploadField = async () => ({}) }: { uploadField?: (...args: any[]) => Promise<any> } = {}
): Harness => {
  const harness = {} as Harness

  const Probe = () => {
    const ctx = useFormContext()
    const result = useFormSubmission({
      mode: 'create',
      fields,
      onSubmit: async () => {},
      isBlocked: () => false,
      ...options,
    } as Parameters<typeof useFormSubmission>[0])
    harness.ctx = ctx
    harness.result = result
    return null
  }

  act(() => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider
          services={
            {
              getCollectionDocuments: async () => ({ docs: [], total: 0 }),
              uploadField,
            } as any
          }
        >
          <FormProvider initialData={{ fields: { title: 'hello' } }} collectionPath="pages">
            <Probe />
          </FormProvider>
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
  return harness
}

describe('form correctness', () => {
  it('retains a submit-time hook error for the editor', async () => {
    const onSubmit = vi.fn()
    const h = renderHookInForm({
      onSubmit,
      fields: [
        {
          ...fields[0],
          hooks: {
            beforeValidate: () => ({ error: 'Title is reserved' }),
          },
        },
      ],
    })
    await act(async () => {
      await h.result.submit()
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.ctx.getErrors()).toContainEqual({ field: 'title', message: 'Title is reserved' })
  })
  it('does not upload a successful file again after another file failed', async () => {
    const uploadField = vi.fn(async (_collection, body) => {
      if (body.get('field') === 'second') throw new Error('second failed')
      return { storedFile: { id: 'stored-first' } }
    })
    const h = renderHookInForm({}, { uploadField })
    act(() => {
      h.ctx.addPendingUpload('first', {
        file: new File(['a'], 'a.txt'),
        previewUrl: 'blob:a',
        collectionPath: 'pages',
      })
      h.ctx.addPendingUpload('second', {
        file: new File(['b'], 'b.txt'),
        previewUrl: 'blob:b',
        collectionPath: 'pages',
      })
    })
    await act(async () => {
      await h.result.submit()
    })
    await act(async () => {
      await h.result.submit()
    })
    expect(uploadField.mock.calls.filter((call) => call[1].get('field') === 'first')).toHaveLength(
      1
    )
  })
  it('validates required descendants of a group', () => {
    const h = renderHookInForm()
    act(() => {
      h.ctx.setFieldValue('details', {})
    })
    const errors = h.ctx.validateForm([
      {
        name: 'details',
        type: 'group',
        fields: [{ name: 'caption', label: 'Caption', type: 'text' }],
      },
    ])
    expect(errors).toContainEqual({
      field: 'details.caption',
      message: 'Caption is required',
      kind: 'required',
    })
  })
  it('does not let an old asynchronous change overwrite newer input', async () => {
    const older = deferred()
    const newer = deferred()
    let change!: (value: any) => void
    let ctx!: ReturnType<typeof useFormContext>
    const Probe = () => {
      ctx = useFormContext()
      change = useFieldChangeHandler(
        {
          name: 'title',
          type: 'text',
          hooks: {
            beforeValidate: async (event) => {
              await (event.value === 'old' ? older.promise : newer.promise)
            },
          },
        },
        'title'
      )
      return null
    }
    act(() => {
      root.render(
        <FormProvider>
          <Probe />
        </FormProvider>
      )
    })
    act(() => {
      change('old')
      change('new')
    })
    await act(async () => {
      newer.resolve()
      await Promise.resolve()
    })
    expect(ctx.getFieldValue('title')).toBe('new')
    await act(async () => {
      older.resolve()
      await Promise.resolve()
    })
    expect(ctx.getFieldValue('title')).toBe('new')
  })
})

describe('field rendering and snapshots', () => {
  it('honors readOnly on a text widget', () => {
    act(() => {
      root.render(
        <FormProvider initialData={{ title: 'Locked' }}>
          <TextField field={{ name: 'title', type: 'text', readOnly: true }} />
        </FormProvider>
      )
    })
    expect(container.querySelector('input')?.readOnly).toBe(true)
  })
  it('inherits readOnly through groups, array groups and blocks while retaining collapse controls', () => {
    const schema: Field[] = [
      { name: 'group', type: 'group', readOnly: true, fields: [{ name: 'text', type: 'text' }] },
      {
        name: 'rows',
        type: 'array',
        readOnly: true,
        fields: [{ name: 'group', type: 'group', fields: [{ name: 'text', type: 'text' }] }],
      },
      {
        name: 'content',
        type: 'blocks',
        readOnly: true,
        blocks: [{ blockType: 'entry', fields: [{ name: 'text', type: 'text' }] }],
      },
    ]
    const data = {
      group: { text: 'one' },
      rows: [{ _id: 'row', group: { text: 'two' } }],
      content: [{ _id: 'block', _type: 'entry', text: 'three' }],
    }
    act(() =>
      root.render(
        <I18nProvider
          bundle={adminTranslations({ locales: ['en'] })}
          activeLocale="en"
          defaultLocale="en"
          localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
        >
          <FormProvider initialData={data}>
            {schema.map((field) => (
              <FieldRenderer
                key={field.name}
                field={field}
                defaultValue={data[field.name as keyof typeof data]}
              />
            ))}
          </FormProvider>
        </I18nProvider>
      )
    )
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    expect(inputs).toHaveLength(3)
    expect(inputs.every((input) => input.readOnly)).toBe(true)
    expect(container.querySelector('[aria-label="Remove item"]')).toBeNull()
    expect([...container.querySelectorAll('button')].some((button) => !button.disabled)).toBe(true)
  })
  it('observes a field write between rendering and passive subscription', () => {
    const Display = () => <span>{useFieldValue<string>('title')}</span>
    const Seed = () => {
      const ctx = useFormContext()
      useLayoutEffect(() => {
        ctx.setFieldValue('title', 'new')
      }, [ctx.setFieldValue])
      return <Display />
    }
    act(() => {
      root.render(
        <FormProvider initialData={{ title: 'old' }}>
          <Seed />
        </FormProvider>
      )
    })
    expect(container.textContent).toBe('new')
  })
})

describe('submission and store contracts', () => {
  it('waits for an outstanding change before validating and saving', async () => {
    const gate = deferred()
    const onSubmit = vi.fn()
    const h = renderHookInForm({ onSubmit })
    h.ctx.trackFieldChange(gate.promise.then(() => h.ctx.setFieldValue('title', 'finished')))
    let submission!: Promise<void>
    await act(async () => {
      submission = h.result.submit()
      await Promise.resolve()
    })
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      gate.resolve()
      await submission
    })
    expect(onSubmit.mock.calls[0]?.[0].data.title).toBe('finished')
  })

  it('does not wait for a superseded pending change', async () => {
    const gate = deferred()
    const onSubmit = vi.fn()
    const h = renderHookInForm({ onSubmit })
    const release = h.ctx.trackFieldChange(gate.promise)
    release()
    await act(async () => {
      await h.result.submit()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    gate.resolve()
  })

  it('allows metadata-only saves when older content lacks a required field', async () => {
    const onSubmit = vi.fn()
    const h = renderHookInForm({
      mode: 'edit',
      onSubmit,
      fields: [{ name: 'newField', type: 'text' }],
    })
    act(() => h.ctx.setSystemPath('/changed'))
    await act(async () => {
      await h.result.submit()
    })
    expect(h.result.phase.kind).toBe('confirmingSystemFields')
    await act(async () => {
      await h.result.confirmSystemFields()
    })
    expect(onSubmit.mock.calls[0]?.[0].contentDirty).toBe(false)
  })

  it('does not resurrect initial descendants after an ancestor is cleared or saved', () => {
    let ctx!: ReturnType<typeof useFormContext>
    const Probe = () => {
      ctx = useFormContext()
      return <span>{useFieldValue<string>('details.title')}</span>
    }
    act(() =>
      root.render(
        <FormProvider initialData={{ details: { title: 'old' } }}>
          <Probe />
        </FormProvider>
      )
    )
    expect(container.textContent).toBe('old')
    act(() => ctx.setFieldValue('details', {}))
    expect(container.textContent).toBe('')
    act(() => ctx.resetHasChanges())
    expect(ctx.getFieldValue('details.title')).toBeUndefined()
  })

  it('keeps a field visible when its condition throws, instead of taking the render down', () => {
    // The predicate runs on every form edit against live, partly-filled data.
    // A predicate assuming a shape the editor has not reached yet must not
    // crash the form; failing closed matches the validation walker.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const field: Field = {
        name: 'doi',
        type: 'text',
        condition: (data: any) => data.missing.deep === 1,
      }
      const Probe = () => <span>{useFieldCondition(field) ? 'visible' : 'hidden'}</span>
      act(() =>
        root.render(
          <FormProvider>
            <Probe />
          </FormProvider>
        )
      )
      expect(container.textContent).toBe('visible')
      expect(errors).toHaveBeenCalledTimes(1)
    } finally {
      errors.mockRestore()
    }
  })

  it('only rerenders tab visibility when a predicate changes, and badges nested errors', () => {
    let ctx!: ReturnType<typeof useFormContext>
    let renders = 0
    const tabs = [
      {
        name: 'main',
        tabs: [
          { name: 'base', label: 'Base', fields: ['title'] },
          {
            name: 'extra',
            label: 'Extra',
            fields: ['details'],
            condition: (data: any) => Boolean(data.show),
          },
        ],
      },
    ]
    const mapping = new Map([['details', { tabSetName: 'main', tabName: 'extra' }]])
    const Probe = () => {
      ctx = useFormContext()
      const state = useFormTabs(mapping, {}, tabs)
      renders++
      return (
        <span>
          {state.resolve(tabs[0]!).visibleTabs.length}:{state.errorCountsBySet.main?.extra ?? 0}
        </span>
      )
    }
    act(() =>
      root.render(
        <FormProvider>
          <Probe />
        </FormProvider>
      )
    )
    const initialRenders = renders
    act(() => ctx.setFieldValue('title', 'unrelated'))
    expect(renders).toBe(initialRenders)
    act(() => ctx.setFieldValue('show', true))
    expect(container.textContent).toBe('2:0')
    act(() => ctx.setFieldError('details.caption', 'Required'))
    expect(container.textContent).toBe('2:1')
  })

  it('does not replace a parked confirmation and rejects a cancelled confirmation callback', async () => {
    const onSubmit = vi.fn()
    const h = renderHookInForm({ mode: 'edit', onSubmit })
    const submit = h.result.submit
    act(() => h.ctx.setSystemPath('/first'))
    await act(async () => {
      await submit()
    })
    const confirm = h.result.confirmSystemFields
    act(() => h.ctx.setSystemPath('/second'))
    await act(async () => {
      await submit()
    })
    if (h.result.phase.kind !== 'confirmingSystemFields') throw new Error('Expected confirmation')
    expect(h.result.phase.payload.systemPath).toBe('/first')
    act(() => h.result.cancelSystemFields())
    await act(async () => {
      await confirm()
    })
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      await submit()
    })
    await act(async () => {
      await h.result.confirmSystemFields()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0].systemPath).toBe('/second')
  })

  it('displays serialized server field errors without clearing dirty state', async () => {
    const h = renderHookInForm({
      onSubmit: async () => {
        throw {
          code: 'ERR_VALIDATION',
          details: {
            reason: 'invalid_document_fields',
            issues: [{ field: 'title', message: 'Required by server' }],
          },
        }
      },
    })
    act(() => h.ctx.setFieldValue('title', 'changed'))
    await act(async () => {
      await h.result.submit()
    })
    expect(h.ctx.getErrors()).toContainEqual({ field: 'title', message: 'Required by server' })
    expect(h.ctx.hasChanges()).toBe(true)
  })

  it('updates composite subscriptions without mutating old snapshots or rerendering unrelated values', () => {
    let ctx!: ReturnType<typeof useFormContext>
    let unrelatedRenders = 0
    const Unrelated = () => {
      unrelatedRenders++
      return <span>{useFieldValue<string>('other')}</span>
    }
    const Composite = () => {
      const value = useFieldValue<{ title: string }>('details')
      return <b>{value?.title}</b>
    }
    const Capture = () => {
      ctx = useFormContext()
      return null
    }
    act(() =>
      root.render(
        <FormProvider initialData={{ fields: { details: { title: 'old' }, other: 'steady' } }}>
          <Capture />
          <Composite />
          <Unrelated />
        </FormProvider>
      )
    )
    const previous = ctx.getFieldValue('details')
    const count = unrelatedRenders
    act(() => ctx.setFieldValue('details.title', 'new'))
    expect(previous.title).toBe('old')
    expect(container.querySelector('b')?.textContent).toBe('new')
    expect(unrelatedRenders).toBe(count)
  })
})
