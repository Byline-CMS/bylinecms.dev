/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { DatePicker, type DatePickerWallTime } from '@byline/ui/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { joinWallTime, resolveScheduledPublicationWallTime } from './scheduled-publication-time.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('the DatePicker wall time survives to a scheduled-publication instant', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function selectTime(date: Date, time: string): Promise<DatePickerWallTime> {
    const onWallTimeChange = vi.fn<(wall: DatePickerWallTime | null) => void>()

    await act(async () => {
      root.render(
        <DatePicker
          id="publication-at"
          name="publication-at"
          mode="datetime"
          initialValue={date}
          onWallTimeChange={onWallTimeChange}
        />
      )
    })

    const input = container.querySelector('#publication-at')
    expect(input).toBeInstanceOf(HTMLInputElement)
    await act(async () => {
      input?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const timeButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === time
    )
    expect(timeButton).toBeInstanceOf(HTMLButtonElement)
    await act(async () => {
      timeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const wall = onWallTimeChange.mock.calls.at(-1)?.[0]
    expect(wall).not.toBeNull()
    expect(wall).toBeDefined()
    return wall as DatePickerWallTime
  }

  it('preserves a spring-forward wall time so the resolver can reject the gap', async () => {
    const wall = await selectTime(new Date(2026, 2, 8, 1, 0), '02:30')

    expect(wall).toEqual({ date: '2026-03-08', time: '02:30' })
    expect(
      resolveScheduledPublicationWallTime(joinWallTime(wall) as string, 'America/New_York')
    ).toEqual({ status: 'nonexistent' })
  })

  it('preserves an autumn-overlap wall time so the resolver can offer both instants', async () => {
    const wall = await selectTime(new Date(2026, 10, 1, 0, 0), '01:30')
    const resolution = resolveScheduledPublicationWallTime(
      joinWallTime(wall) as string,
      'America/New_York'
    )

    expect(wall).toEqual({ date: '2026-11-01', time: '01:30' })
    expect(resolution.status).toBe('valid')
    expect(resolution.status === 'valid' && resolution.choices).toHaveLength(2)
  })
})
