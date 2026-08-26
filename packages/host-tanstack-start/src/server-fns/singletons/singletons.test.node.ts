/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAdminBylineClient: vi.fn(),
  resolveActorLabels: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (input: unknown) => input
    const chain = {
      validator(validator: (input: unknown) => unknown) {
        validate = validator
        return chain
      },
      handler(handler: (options: { data: any }) => Promise<unknown>) {
        return async (options: { data: unknown }) => handler({ data: validate(options.data) })
      },
    }
    return chain
  },
}))

vi.mock('@byline/client/server', () => ({
  getAdminBylineClient: mocks.getAdminBylineClient,
}))

vi.mock('../actors.js', () => ({
  resolveActorLabels: mocks.resolveActorLabels,
}))

import { cancelSingletonScheduledPublish } from './cancel-scheduled-publish.js'
import { changeSingletonStatus } from './change-status.js'
import { confirmSingletonScheduledPublish } from './confirm-scheduled-publish.js'
import { copySingletonToLocale } from './copy-to-locale.js'
import { findSingletonByVersion } from './find-by-version.js'
import { getSingleton } from './get.js'
import { getSingletonScheduledPublish } from './get-scheduled-publish.js'
import { getSingletonHistory } from './history.js'
import { restoreSingletonVersion } from './restore-version.js'
import { scheduleSingletonPublish } from './schedule-publish.js'
import { unpublishSingleton } from './unpublish.js'
import { updateSingleton } from './update.js'

type ServerFunction = (options: { data: any }) => Promise<any>

const invoke = (serverFunction: unknown, data: Record<string, any>) =>
  (serverFunction as ServerFunction)({ data })

const handle = {
  get: vi.fn(),
  update: vi.fn(),
  changeStatus: vi.fn(),
  unpublish: vi.fn(),
  schedulePublish: vi.fn(),
  confirmScheduledPublish: vi.fn(),
  cancelScheduledPublish: vi.fn(),
  getScheduledPublish: vi.fn(),
  history: vi.fn(),
  findByVersion: vi.fn(),
  restoreVersion: vi.fn(),
  copyToLocale: vi.fn(),
}

const client = { singleton: vi.fn(() => handle) }

describe('singleton server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminBylineClient.mockReturnValue(client)
    mocks.resolveActorLabels.mockResolvedValue({ actor: { label: 'Ada Editor' } })
  })

  it('delegates every operation to the singleton handle for the requested path', async () => {
    const cases = [
      {
        serverFunction: getSingleton,
        method: 'get',
        input: { singleton: 'site-settings', locale: 'fr' },
        args: [
          {
            locale: 'fr',
            populate: undefined,
            depth: undefined,
            status: 'any',
            onMissingLocale: 'empty',
            lenient: true,
          },
        ],
        result: { title: 'Site' },
      },
      {
        serverFunction: updateSingleton,
        method: 'update',
        input: {
          singleton: 'site-settings',
          data: { title: 'Changed' },
          locale: 'fr',
          expectedVersionId: 'version-1',
        },
        args: [{ title: 'Changed' }, { locale: 'fr', expectedVersionId: 'version-1' }],
        result: { versionId: 'version-2' },
      },
      {
        serverFunction: changeSingletonStatus,
        method: 'changeStatus',
        input: { singleton: 'site-settings', status: 'published' },
        args: ['published'],
        result: { newStatus: 'published' },
      },
      {
        serverFunction: unpublishSingleton,
        method: 'unpublish',
        input: { singleton: 'site-settings' },
        args: [],
        result: { archivedCount: 1 },
      },
      {
        serverFunction: scheduleSingletonPublish,
        method: 'schedulePublish',
        input: {
          singleton: 'site-settings',
          publishAt: '2026-09-01T10:00:00Z',
          expectedVersionId: 'version-2',
        },
        args: [
          {
            publishAt: '2026-09-01T10:00:00Z',
            expectedVersionId: 'version-2',
          },
        ],
        result: { state: 'armed' },
      },
      {
        serverFunction: confirmSingletonScheduledPublish,
        method: 'confirmScheduledPublish',
        input: { singleton: 'site-settings', expectedVersionId: 'version-3' },
        args: [{ expectedVersionId: 'version-3' }],
        result: { state: 'armed' },
      },
      {
        serverFunction: cancelSingletonScheduledPublish,
        method: 'cancelScheduledPublish',
        input: { singleton: 'site-settings' },
        args: [],
        result: { state: 'cancelled' },
      },
      {
        serverFunction: getSingletonScheduledPublish,
        method: 'getScheduledPublish',
        input: { singleton: 'site-settings' },
        args: [],
        result: { state: 'armed' },
      },
      {
        serverFunction: getSingletonHistory,
        method: 'history',
        input: {
          singleton: 'site-settings',
          params: { locale: 'all', page: 2, page_size: 10, order: 'created_at', desc: true },
        },
        args: [{ locale: 'all', page: 2, pageSize: 10, order: 'created_at', desc: true }],
        result: {
          docs: [{ createdBy: 'actor', versionId: 'version-1' }],
          meta: { total: 1, page: 2, pageSize: 10, totalPages: 1 },
        },
        actors: true,
      },
      {
        serverFunction: findSingletonByVersion,
        method: 'findByVersion',
        input: { singleton: 'site-settings', versionId: 'version-1', locale: 'fr' },
        args: ['version-1', { locale: 'fr' }],
        result: { title: 'Historical' },
      },
      {
        serverFunction: restoreSingletonVersion,
        method: 'restoreVersion',
        input: { singleton: 'site-settings', versionId: 'version-1' },
        args: ['version-1'],
        result: { versionId: 'version-4' },
      },
      {
        serverFunction: copySingletonToLocale,
        method: 'copyToLocale',
        input: {
          singleton: 'site-settings',
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: true,
        },
        args: [{ sourceLocale: 'en', targetLocale: 'fr', overwrite: true }],
        result: { versionId: 'version-5' },
      },
    ] as const

    for (const testCase of cases) {
      const method = handle[testCase.method]
      method.mockResolvedValueOnce(testCase.result)

      const result = await invoke(testCase.serverFunction, testCase.input)

      expect(client.singleton).toHaveBeenLastCalledWith('site-settings')
      expect(method).toHaveBeenCalledWith(...testCase.args)
      expect(result).toEqual(
        testCase.actors
          ? { ...testCase.result, actors: { actor: { label: 'Ada Editor' } } }
          : testCase.result
      )
    }
  })

  it('forwards the optimistic version to update unchanged', async () => {
    handle.update.mockResolvedValueOnce({ versionId: 'version-next' })

    await invoke(updateSingleton, {
      singleton: 'site-settings',
      data: { title: 'Changed' },
      expectedVersionId: 'version-current',
    })

    expect(handle.update).toHaveBeenCalledWith(
      { title: 'Changed' },
      { locale: undefined, expectedVersionId: 'version-current' }
    )
  })

  it('preserves authentication failures from the handle', async () => {
    const error = { code: 'ERR_UNAUTHENTICATED', message: 'sign in required' }
    handle.get.mockRejectedValueOnce(error)

    await expect(invoke(getSingleton, { singleton: 'site-settings' })).rejects.toBe(error)
  })

  it('keeps missing-slot and stale-write failures distinguishable', async () => {
    const missing = { code: 'ERR_NOT_FOUND', message: 'slot is empty' }
    const stale = { code: 'ERR_CONFLICT', message: 'version changed' }
    handle.changeStatus.mockRejectedValueOnce(missing)
    handle.update.mockRejectedValueOnce(stale)

    await expect(
      invoke(changeSingletonStatus, { singleton: 'site-settings', status: 'published' })
    ).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
    await expect(
      invoke(updateSingleton, {
        singleton: 'site-settings',
        data: { title: 'Changed' },
        expectedVersionId: 'stale',
      })
    ).rejects.toMatchObject({ code: 'ERR_CONFLICT' })
  })

  it('serialises schedule dates at the transport boundary', async () => {
    handle.getScheduledPublish.mockResolvedValueOnce({
      state: 'armed',
      publishAt: new Date('2026-09-01T10:00:00Z'),
    })

    await expect(
      invoke(getSingletonScheduledPublish, { singleton: 'site-settings' })
    ).resolves.toMatchObject({ publishAt: '2026-09-01T10:00:00.000Z' })
  })
})
