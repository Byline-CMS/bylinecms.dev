'use client'

/**
 * @file DatePicker component using react-day-picker and @base-ui/react
 * Portions copyright (c) 2023 Maliksidk19 licensed under the MIT
 * license found in the LICENSE file in the root directory of this source tree.
 * of https://github.com/Maliksidk19/shadcn-datetime-picker/
 */

import type React from 'react'
import { useEffect, useRef, useState } from 'react'

import { Popover } from '@base-ui/react/popover'
import cx from 'clsx'
import { format } from 'date-fns'

import { Button } from '../../components/button/button.js'
import { IconButton } from '../../components/button/icon-button.js'
import { Calendar } from '../../components/inputs/calendar.jsx'
import { Input } from '../../components/inputs/input.jsx'
import { InputAdornment } from '../../components/inputs/input-adornment.jsx'
import { ScrollArea } from '../../components/scroll-area/scroll-area.js'
import { CalendarIcon } from '../../icons/calendar-icon.js'
import { CloseIcon } from '../../icons/close-icon.js'
import styles from './datepicker.module.css'
import type { Intent, Size, Variant } from '../../components/inputs/@types/input.js'

/**
 * The selection as the editor made it: a calendar day and a clock reading,
 * with no instant attached.
 *
 * `onDateChange` reports a `Date`, which is an instant, and building one from a
 * wall time goes through `setHours` — so on the two days a year the clocks
 * change, the instant is not the time that was picked. A spring-forward 02:30
 * comes back as 03:30, and an ambiguous autumn 01:30 silently resolves to the
 * earlier of its two instants. Callers that must reject or disambiguate those
 * cases need the wall time itself, which is what this carries.
 */
export interface DatePickerWallTime {
  /** Calendar day as `YYYY-MM-DD`. */
  date: string
  /** Clock reading as `HH:mm`, 24-hour. */
  time: string
}

export interface DatePickerProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string
  name: string
  label?: string
  required?: boolean
  initialValue?: Date | null
  mode?: 'date' | 'datetime'
  /**
   * Earliest selectable day. Days before it are disabled in the calendar and
   * the month navigation will not go back past its month.
   *
   * Day granularity only — the day containing `minDate` stays selectable in
   * full, and in `datetime` mode every slot in the time list remains offered.
   * A caller that needs a cutoff finer than a day has to enforce it itself.
   */
  minDate?: Date
  yearsInFuture?: number
  yearsInPast?: number
  variant?: Variant
  inputSize?: Size
  inputWrapperClassName?: string
  inputClassName?: string
  intent?: Intent
  containerClassName?: string
  contentClassName?: string
  helpText?: string
  errorText?: string
  ariaLabelForSearch?: string
  ariaLabelForClear?: string
  onClear?: () => void
  onDateChange?: (value: Date | null) => void
  /**
   * Fired alongside `onDateChange` with the day and clock reading the editor
   * actually selected, before any instant is derived from them. Optional and
   * additive — callers that are happy with the `Date` can ignore it entirely.
   * Reports `null` when the selection is cleared.
   */
  onWallTimeChange?: (wall: DatePickerWallTime | null) => void
  validatorFn?: (value: Date) => {
    valid: boolean
    value: Date
  }
  placeHolderText?: string
}

export function DatePicker({
  id,
  name,
  label,
  required,
  initialValue,
  mode = 'datetime',
  minDate,
  yearsInFuture = 1,
  yearsInPast = 10,
  variant,
  intent,
  inputSize,
  inputClassName,
  inputWrapperClassName,
  containerClassName,
  contentClassName,
  onClear = () => {},
  onDateChange = () => {},
  onWallTimeChange,
  validatorFn,
  helpText,
  errorText,
  placeHolderText = '',
  ariaLabelForSearch = 'date',
  ariaLabelForClear = 'clear',
  ...rest
}: DatePickerProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [date, setDate] = useState<Date | null>(() => {
    if (initialValue) {
      return initialValue
    }
    if (initialValue == null && required === true) {
      return new Date()
    }
    return null
  })
  // Seeded from the incoming date so the clock the widget holds agrees with the
  // date it is showing. Declared after `date` for that reason. Previously this
  // always started at 08:00, so picking a different day on a picker opened at
  // 17:56 silently moved the value to 08:00.
  const [time, setTime] = useState<string>(() => (date != null ? format(date, 'HH:mm') : '08:00'))
  const [month, setMonth] = useState<Date | null>(date)
  const calendarRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasInitialized = useRef(false)

  const handleClear = (): void => {
    if (inputRef?.current != null) {
      inputRef.current.value = ''
    }
    setDate(null)
    onDateChange(null)
    emitWallTime(null, time)
    onClear()
  }

  const handleOnDateChange = (value: Date | null): void => {
    if (onDateChange != null && typeof onDateChange === 'function') {
      onDateChange(value)
    }
  }

  /**
   * Report the selection as a wall time. `clock` is passed explicitly wherever
   * the editor's chosen clock reading is known independently of `day`, because
   * `day` has already been through `setHours` by then and cannot be trusted to
   * still say what was picked.
   */
  const emitWallTime = (day: Date | null, clock: string): void => {
    if (onWallTimeChange == null) return
    onWallTimeChange(day == null ? null : { date: format(day, 'yyyy-MM-dd'), time: clock })
  }

  const handleOnKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
    }
  }

  // This is to handle cases where the date picker is used in a form and the initial
  // value is not set, but the field is required. In such cases, we want
  // to trigger the onDateChange callback with the current date to ensure that
  // the form is valid and the date picker is initialized with a value.
  // Runs only once on mount
  useEffect(() => {
    if (
      initialValue == null &&
      date != null &&
      required === true &&
      hasInitialized.current === false
    ) {
      hasInitialized.current = true
      onDateChange(date)
      emitWallTime(date, time)
    }
  })

  return (
    <div className={cx('byline-datepicker-container', styles.container, containerClassName)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-8)' }}>
        <Input
          id={id}
          label={label}
          readOnly
          required={required}
          name={name}
          variant={variant}
          intent={intent}
          inputSize={inputSize}
          ref={inputRef}
          className={cx('byline-datepicker-input', styles.input, inputClassName)}
          inputWrapperClassName={cx(
            'byline-datepicker-input-wrapper',
            styles['input-wrapper'],
            inputWrapperClassName
          )}
          onKeyDown={handleOnKeyDown}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsOpen(true)
          }}
          value={date ? format(date, mode === 'datetime' ? 'PP HH:mm' : 'PP') : ''}
          placeHolder={placeHolderText}
          helpText={helpText}
          disabled={false}
          error={false}
          endAdornment={
            <InputAdornment position="end">
              <IconButton
                role="button"
                intent="noeffect"
                variant="text"
                arial-label={ariaLabelForClear}
                size="xs"
                onClick={() => {
                  handleClear()
                }}
              >
                <CloseIcon width="14px" height="14px" />
              </IconButton>
              <IconButton
                role="button"
                intent="noeffect"
                variant="text"
                arial-label={ariaLabelForClear}
                size="xs"
                onClick={() => {
                  setIsOpen(true)
                }}
              >
                <CalendarIcon width="18px" height="18px" />
              </IconButton>
            </InputAdornment>
          }
          {...rest}
        />
      </div>

      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger
          nativeButton={false}
          render={<div style={{ position: 'relative', height: '1px' }} />}
        >
          <span className="sr-only">Select date</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            sideOffset={5}
            className={cx('byline-datepicker-positioner', styles.positioner)}
          >
            <Popover.Popup
              className={cx('byline-datepicker-content', styles.content, contentClassName)}
            >
              <div
                className={cx('byline-datepicker-content-components', styles['content-components'])}
              >
                <div ref={calendarRef}>
                  <Calendar
                    mode="single"
                    required
                    captionLayout="dropdown"
                    selected={date ?? undefined}
                    month={month ?? undefined}
                    onMonthChange={setMonth}
                    onSelect={(selectedDate: Date) => {
                      if (selectedDate) {
                        // Read the day before `setHours` mutates it: the
                        // editor picked this day at the clock reading already
                        // held in `time`, and normalization can move both.
                        const day = new Date(selectedDate.getTime())
                        const [hours, minutes] = time.split(':')
                        selectedDate.setHours(
                          Number.parseInt(hours, 10),
                          Number.parseInt(minutes, 10)
                        )
                        setDate(selectedDate)
                        setMonth(selectedDate)
                        handleOnDateChange(selectedDate)
                        emitWallTime(day, time)
                      }
                    }}
                    disabled={minDate == null ? undefined : { before: minDate }}
                    // Clamp the navigable range to `minDate`'s month as well as
                    // disabling the days, so the editor is not offered months
                    // in which nothing can be picked.
                    startMonth={minDate ?? new Date(new Date().getFullYear() - yearsInPast, 0)}
                    endMonth={new Date(new Date().getFullYear() + yearsInFuture, 0)}
                  />
                </div>
                {mode === 'datetime' && (
                  <div className={styles['time-picker-container']}>
                    <ScrollArea className={styles['time-picker-scroll-area']}>
                      <div className={styles['time-picker']}>
                        {Array.from({ length: 96 }).map((_, i) => {
                          const hour = Math.floor(i / 4)
                            .toString()
                            .padStart(2, '0')
                          const minute = ((i % 4) * 15).toString().padStart(2, '0')
                          const timeValue = `${hour}:${minute}`
                          return (
                            <Button
                              key={i}
                              size="sm"
                              className={styles['time-picker-button']}
                              variant="outlined"
                              onClick={() => {
                                setTime(timeValue)
                                if (date) {
                                  const newDate = new Date(date.getTime())
                                  newDate.setHours(
                                    Number.parseInt(hour, 10),
                                    Number.parseInt(minute, 10),
                                    0
                                  )
                                  setDate(newDate)
                                  handleOnDateChange(newDate)
                                  // `date`, not `newDate` — the grid label is
                                  // what was clicked, and `newDate` may have
                                  // been normalized away from it.
                                  emitWallTime(date, timeValue)
                                }
                              }}
                            >
                              {timeValue}
                            </Button>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
              <div
                className={cx('byline-datepicker-status-and-actions', styles['status-and-actions'])}
              >
                <div className={cx('byline-datepicker-content-status', styles['content-status'])}>
                  {date ? format(date, mode === 'datetime' ? 'PPPp' : 'PPP') : 'No date selected'}
                </div>
                <div className={cx('byline-datepicker-content-actions', styles['content-actions'])}>
                  <div>
                    <Button
                      variant="outlined"
                      size="sm"
                      className={cx(
                        'byline-datepicker-content-actions-button',
                        styles['content-actions-button']
                      )}
                      onClick={() => {
                        const today = new Date()
                        const clock = format(today, 'HH:mm')
                        setDate(today)
                        setMonth(today)
                        // Keep the held clock in step with the value, so a
                        // subsequent day pick preserves this time.
                        setTime(clock)
                        handleOnDateChange(today)
                        emitWallTime(today, clock)
                      }}
                    >
                      Today
                    </Button>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--spacing-12)' }}>
                    <Button
                      size="sm"
                      intent="noeffect"
                      className={cx(
                        'byline-datepicker-content-actions-button',
                        styles['content-actions-button']
                      )}
                      onClick={() => {
                        setIsOpen(false)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="outlined"
                      size="sm"
                      className={cx(
                        'byline-datepicker-content-actions-button',
                        styles['content-actions-button']
                      )}
                      onClick={() => {
                        setIsOpen(false)
                        handleOnDateChange(date)
                        emitWallTime(date, time)
                      }}
                    >
                      Select
                    </Button>
                  </div>
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
