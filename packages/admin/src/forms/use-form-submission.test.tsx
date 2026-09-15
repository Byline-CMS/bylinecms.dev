/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormProvider, useFormContext } from './form-context'
import { type UseFormSubmissionResult, useFormSubmission } from './use-form-submission'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

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

describe('useFormSubmission phases', () => {
  it('moves idle → validating → submitting → idle when nothing is queued for upload', async () => {
    const validation = deferred()
    const submission = deferred()
    const order: string[] = []
    const gatedFields = [
      {
        name: 'title',
        label: 'Title',
        type: 'text' as const,
        hooks: {
          beforeValidate: async () => {
            order.push('validate')
            await validation.promise
            return undefined
          },
        },
      },
    ]
    const h = renderHookInForm({
      fields: gatedFields,
      onSubmit: async () => {
        order.push('submit')
        await submission.promise
      },
    })

    expect(h.result.phase.kind).toBe('idle')

    let pending!: Promise<void>
    await act(async () => {
      pending = h.result.submit()
      await Promise.resolve()
    })
    expect(h.result.phase.kind).toBe('validating')

    await act(async () => {
      validation.resolve()
      await Promise.resolve()
    })
    expect(h.result.phase.kind).toBe('submitting')

    await act(async () => {
      submission.resolve()
      await pending
    })
    expect(h.result.phase.kind).toBe('idle')
    expect(order).toEqual(['validate', 'submit'])
  })

  it('is not busy while validating, so the form is not made inert before work starts', async () => {
    const validation = deferred()
    const gatedFields = [
      {
        name: 'title',
        label: 'Title',
        type: 'text' as const,
        hooks: {
          beforeValidate: async () => {
            await validation.promise
            return undefined
          },
        },
      },
    ]
    const h = renderHookInForm({ fields: gatedFields })

    let pending!: Promise<void>
    await act(async () => {
      pending = h.result.submit()
      await Promise.resolve()
    })
    expect(h.result.phase.kind).toBe('validating')
    expect(h.result.isBusy).toBe(false)

    await act(async () => {
      validation.resolve()
      await pending
    })
    expect(h.result.isBusy).toBe(false)
  })

  it('is busy while submitting', async () => {
    const gate = deferred()
    const h = renderHookInForm({ onSubmit: async () => gate.promise })

    expect(h.result.isBusy).toBe(false)
    let pending!: Promise<void>
    await act(async () => {
      pending = h.result.submit()
      await Promise.resolve()
    })
    expect(h.result.phase.kind).toBe('submitting')
    expect(h.result.isBusy).toBe(true)

    await act(async () => {
      gate.resolve()
      await pending
    })
    expect(h.result.isBusy).toBe(false)
  })
})

describe('useFormSubmission re-entry protection', () => {
  it('admits only one submission when two are issued in the same turn', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ onSubmit })

    await act(async () => {
      const first = h.result.submit()
      const second = h.result.submit() // no await between them; no rerender either
      await Promise.all([first, second])
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('guards the whole window, not just the final request', async () => {
    // The second call lands while the first is still validating. Rendered state
    // still says 'idle' at that moment, so only a synchronous ref can refuse it.
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ onSubmit })

    await act(async () => {
      const first = h.result.submit()
      const duringValidation = h.result.submit()
      await Promise.all([first, duringValidation])
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('accepts a second submission once the first has finished', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ onSubmit })

    await act(async () => {
      await h.result.submit()
    })
    await act(async () => {
      await h.result.submit()
    })

    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
})

describe('useFormSubmission mutation blocking', () => {
  it('refuses to submit while mutations are blocked', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ onSubmit, isBlocked: () => true })

    await act(async () => {
      await h.result.submit()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.result.phase.kind).toBe('idle')
  })

  it('abandons a submission if mutations become blocked during validation', async () => {
    const onSubmit = vi.fn(async () => {})
    let blocked = false
    const h = renderHookInForm({ onSubmit, isBlocked: () => blocked })

    await act(async () => {
      const pending = h.result.submit()
      blocked = true
      await pending
    })

    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('useFormSubmission settles the phase on every exit', () => {
  // Every non-delivery exit must leave a settled phase. A return that skips the
  // reset strands the form: `isBusy` stays true, so FormContent keeps it inert
  // and the save indicator spinning with nothing in flight.
  it('returns to idle when a mutation block arrives during upload', async () => {
    const upload = deferred()
    const onSubmit = vi.fn(async () => {})
    let blocked = false
    const h = renderHookInForm(
      { onSubmit, isBlocked: () => blocked },
      {
        uploadField: async () => {
          await upload.promise
          return { id: 'file-1', filename: 'x.png' }
        },
      }
    )
    act(() => {
      h.ctx.setFieldValue('title', 'dirty title')
      h.ctx.addPendingUpload('cover', {
        file: new File(['x'], 'x.png', { type: 'image/png' }),
        previewUrl: 'blob:preview',
      } as any)
    })

    let pending!: Promise<void>
    await act(async () => {
      pending = h.result.submit()
      await Promise.resolve()
    })
    expect(h.result.phase.kind).toBe('uploading')

    await act(async () => {
      blocked = true
      upload.resolve()
      await pending
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.ctx.hasChanges()).toBe(true)
    expect(h.result.phase.kind).toBe('idle')
    expect(h.result.isBusy).toBe(false)
  })

  it('returns to idle when a mutation block arrives while confirming system fields', async () => {
    const onSubmit = vi.fn(async () => {})
    let blocked = false
    const h = renderHookInForm({
      mode: 'edit',
      documentId: 'doc-1',
      onSubmit,
      isBlocked: () => blocked,
    })

    act(() => {
      h.ctx.setSystemPath('/moved')
    })
    await act(async () => {
      await h.result.submit()
    })
    expect(h.result.phase.kind).toBe('confirmingSystemFields')

    await act(async () => {
      blocked = true
      await h.result.confirmSystemFields()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.result.phase.kind).toBe('idle')
  })

  it('returns to idle when no submit handler is supplied', async () => {
    const h = renderHookInForm({ onSubmit: undefined as any })

    await act(async () => {
      await h.result.submit()
    })

    expect(h.result.phase.kind).toBe('idle')
    expect(h.result.isBusy).toBe(false)
  })
})

describe('useFormSubmission system-field confirmation', () => {
  const editOptions = { mode: 'edit' as const, documentId: 'doc-1' }

  it('holds the payload for confirmation when only system fields are dirty', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ ...editOptions, onSubmit })

    act(() => {
      h.ctx.setSystemPath('/moved')
    })
    await act(async () => {
      await h.result.submit()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.result.phase.kind).toBe('confirmingSystemFields')
    if (h.result.phase.kind !== 'confirmingSystemFields') throw new Error('unreachable')
    expect(h.result.phase.payload.pathDirty).toBe(true)
    expect(h.result.phase.payload.systemPath).toBe('/moved')
  })

  it('submits the held payload on confirmation', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ ...editOptions, onSubmit })

    act(() => {
      h.ctx.setSystemPath('/moved')
    })
    await act(async () => {
      await h.result.submit()
    })
    await act(async () => {
      await h.result.confirmSystemFields()
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ pathDirty: true, systemPath: '/moved' })
    expect(h.result.phase.kind).toBe('idle')
  })

  it('discards the held payload on cancellation', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ ...editOptions, onSubmit })

    act(() => {
      h.ctx.setSystemPath('/moved')
    })
    await act(async () => {
      await h.result.submit()
    })
    act(() => {
      h.result.cancelSystemFields()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.result.phase.kind).toBe('idle')
  })

  it('does not confirm in create mode', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm({ mode: 'create', onSubmit })

    act(() => {
      h.ctx.setSystemPath('/moved')
    })
    await act(async () => {
      await h.result.submit()
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('useFormSubmission busy transitions', () => {
  it('signals onBeforeBusy before the form becomes busy', async () => {
    const order: string[] = []
    const h = renderHookInForm({
      onBeforeBusy: () => order.push('beforeBusy'),
      onSubmit: async () => {
        order.push('submit')
      },
    })

    await act(async () => {
      await h.result.submit()
    })

    expect(order).toEqual(['beforeBusy', 'submit'])
  })

  it('does not signal onBeforeBusy when validation fails', async () => {
    const onBeforeBusy = vi.fn()
    const onSubmit = vi.fn(async () => {})
    const required = [{ name: 'title', label: 'Title', type: 'text' as const, required: true }]
    const h = renderHookInForm({ fields: required, onBeforeBusy, onSubmit })

    act(() => {
      h.ctx.setFieldValue('title', '')
    })
    await act(async () => {
      await h.result.submit()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onBeforeBusy).not.toHaveBeenCalled()
    expect(h.result.phase.kind).toBe('idle')
  })
})

describe('useFormSubmission upload sequencing', () => {
  const queueUpload = (h: Harness) => {
    act(() => {
      h.ctx.addPendingUpload('cover', {
        file: new File(['x'], 'x.png', { type: 'image/png' }),
        previewUrl: 'blob:preview',
      } as any)
    })
  }

  it('uploads before submitting and returns to idle', async () => {
    const order: string[] = []
    const h = renderHookInForm(
      {
        onSubmit: async () => {
          order.push('submit')
        },
      },
      {
        uploadField: async () => {
          order.push('upload')
          return { id: 'file-1', filename: 'x.png' }
        },
      }
    )
    queueUpload(h)

    await act(async () => {
      await h.result.submit()
    })

    expect(order).toEqual(['upload', 'submit'])
    expect(h.result.phase.kind).toBe('idle')
  })

  it('reports the uploading phase while uploads are in flight', async () => {
    const gate = deferred()
    const h = renderHookInForm(
      {},
      {
        uploadField: async () => {
          await gate.promise
          return { id: 'file-1', filename: 'x.png' }
        },
      }
    )
    queueUpload(h)

    let pending!: Promise<void>
    await act(async () => {
      pending = h.result.submit()
      await Promise.resolve()
    })
    expect(h.result.phase.kind).toBe('uploading')
    expect(h.result.isBusy).toBe(true)

    await act(async () => {
      gate.resolve()
      await pending
    })
    expect(h.result.phase.kind).toBe('idle')
  })

  it('does not submit when an upload fails', async () => {
    const onSubmit = vi.fn(async () => {})
    const h = renderHookInForm(
      { onSubmit },
      {
        uploadField: async () => {
          throw new Error('upload exploded')
        },
      }
    )
    queueUpload(h)

    await act(async () => {
      await h.result.submit()
    })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.result.phase.kind).toBe('idle')
  })
})
