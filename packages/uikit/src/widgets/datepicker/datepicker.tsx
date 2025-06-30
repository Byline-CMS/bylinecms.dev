'use client'
/**
 * @file DatePicker component using react-day-picker and radix-ui
 * Portions copyright (c) 2023 Maliksidk19 licensed under the MIT
 * license found in the LICENSE file in the root directory of this source tree.
 * of https://github.com/Maliksidk19/shadcn-datetime-picker/
 */

import cx from 'classnames'
import { format } from 'date-fns'
import { Popover } from 'radix-ui'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/button/button.js'
import { IconButton } from '../../components/button/icon-button.js'
import { Calendar } from '../../components/calendar/calendar.js'
import { Input, InputAdornment } from '../../components/input'
import type { Intent, Size, Variant } from '../../components/input/@types/input.js'
import { ScrollArea } from '../../components/scroll-area/scroll-area.js'
import { CalendarIcon } from '../../icons/calendar-icon.js'
import { CloseIcon } from '../../icons/close-icon.js'
import styles from './datepicker.module.css'

export interface DatePickerProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string
  name: string
  label?: string
  required?: boolean
  initialValue?: Date
  mode?: 'date' | 'datetime'
  yearsInFuture?: number
  yearsInPast?: number
  variant?: Variant
  inputSize?: Size
  inputWrapperClassName?: string
  inputClassName?: string
  intent?: Intent
  containerClassName?: string
  helpText?: string
  errorText?: string
  ariaLabelForSearch?: string
  ariaLabelForClear?: string
  onClear?: () => void
  onDateChange?: (value: Date | undefined) => void
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
  yearsInFuture = 1,
  yearsInPast = 10,
  variant,
  intent,
  inputSize,
  inputClassName,
  inputWrapperClassName,
  containerClassName,
  onClear = () => {},
  onDateChange = () => {},
  validatorFn,
  helpText,
  errorText,
  placeHolderText = '',
  ariaLabelForSearch = 'date',
  ariaLabelForClear = 'clear',
  ...rest
}: DatePickerProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [time, setTime] = useState<string>('08:00')
  const [date, setDate] = useState<Date | undefined>(() => {
    if (initialValue) {
      return initialValue
    }
    if (initialValue == null && required === true) {
      return new Date()
    }
    return undefined
  })
  const [month, setMonth] = useState<Date | undefined>(date)
  const calendarRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasInitialized = useRef(false)

  const handleClear = (): void => {
    if (inputRef?.current != null) {
      inputRef.current.value = ''
    }
    setDate(undefined)
    onDateChange(undefined)
    onClear()
  }

  const handleOnDateChange = (value: Date | undefined): void => {
    if (onDateChange != null && typeof onDateChange === 'function') {
      onDateChange(value)
    }
  }

  const handleOnKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
    }
  }

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
    }
  })

  return (
    <div className={cx(styles.container, containerClassName)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
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
          className={cx(styles.input, inputClassName)}
          inputWrapperClassName={cx(styles['input-wrapper'], inputWrapperClassName)}
          onKeyDown={handleOnKeyDown}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsOpen(true)
          }}
          value={date ? `${format(date, 'PP HH:mm')}` : ''}
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
        <Popover.Trigger asChild>
          <div style={{ position: 'relative', height: '1px' }}>
            <span className="sr-only">Select date</span>
          </div>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={5} className={styles.content}>
            <div className={styles['content-components']}>
              <div ref={calendarRef}>
                <Calendar
                  mode="single"
                  required
                  captionLayout="dropdown"
                  selected={date}
                  month={month}
                  onMonthChange={setMonth}
                  onSelect={(selectedDate: Date) => {
                    if (selectedDate) {
                      const [hours, minutes] = time.split(':')
                      selectedDate.setHours(Number.parseInt(hours), Number.parseInt(minutes))
                      setDate(selectedDate)
                      setMonth(selectedDate)
                      handleOnDateChange(selectedDate)
                    }
                  }}
                  startMonth={new Date(new Date().getFullYear() - yearsInPast, 0)}
                  endMonth={new Date(new Date().getFullYear() + yearsInFuture, 0)}
                  // TODO: add props
                  // disabled={(date) =>
                  //   Number(date) < Date.now() - 1000 * 60 * 60 * 24 ||
                  //   Number(date) > Date.now() + 1000 * 60 * 60 * 24 * 30
                  // }
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
                                newDate.setHours(Number.parseInt(hour), Number.parseInt(minute), 0)
                                setDate(newDate)
                                handleOnDateChange(newDate)
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
            <div className={styles['status-and-actions']}>
              <div className={styles['content-status']}>
                {date ? `${format(date, 'PPPp')}` : 'No date selected'}
              </div>
              <div className={styles['content-actions']}>
                <div>
                  <Button
                    variant="outlined"
                    size="sm"
                    className={styles['content-actions-button']}
                    onClick={() => {
                      const today = new Date()
                      setDate(today)
                      setMonth(today)
                      handleOnDateChange(today)
                    }}
                  >
                    Today
                  </Button>
                </div>
                <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                  <Button
                    size="sm"
                    intent="noeffect"
                    className={styles['content-actions-button']}
                    onClick={() => {
                      setIsOpen(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="outlined"
                    size="sm"
                    className={styles['content-actions-button']}
                    onClick={() => {
                      setIsOpen(false)
                      handleOnDateChange(date)
                    }}
                  >
                    Select
                  </Button>
                </div>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
