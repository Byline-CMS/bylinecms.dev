'use client'

/**
 * @file Calendar component using react-day-picker and @base-ui/react
 * @see https://github.com/Maliksidk19/shadcn-datetime-picker/
 * Portions copyright (c) 2023 Maliksidk19 licensed under the MIT
 * license found in the LICENSE file in the root directory of this source tree.
 * of https://github.com/Maliksidk19/shadcn-datetime-picker/
 */

import * as React from 'react'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import cx from 'classnames'
import {
  DayPicker,
  type DayPickerProps,
  type Dropdown as DropDownDayPicker,
} from 'react-day-picker'

import { ChevronsUpDown } from '../../icons/chevrons-up-down.jsx'
import { Button } from '../button/button.jsx'
import { ScrollArea } from '../scroll-area/scroll-area.jsx'
import styles from './calendar.module.css'

export type CalendarProps = DayPickerProps & {
  ref?: React.RefObject<HTMLDivElement>
  captionLabelClassName?: string
  dayClassName?: string
  dayButtonClassName?: string
  dropdownsClassName?: string
  footerClassName?: string
  monthClassName?: string
  monthCaptionClassName?: string
  monthGridClassName?: string
  monthsClassName?: string
  weekClassName?: string
  weekdayClassName?: string
  weekdaysClassName?: string
  rangeEndClassName?: string
  rangeMiddleClassName?: string
  rangeStartClassName?: string
  selectedClassName?: string
  disabledClassName?: string
  hiddenClassName?: string
  outsideClassName?: string
  todayClassName?: string
  selectTriggerClassName?: string
}

export function Calendar({
  ref,
  className,
  classNames,
  hideNavigation,
  showOutsideDays = true,
  components: customComponents,
  ...props
}: CalendarProps) {
  const _monthsClassName = cx(styles.months, props.monthsClassName)
  const _monthCaptionClassName = cx(styles['months-caption'], props.monthCaptionClassName)
  const _dropdownsClassName = cx(styles.dropdowns, props.dropdownsClassName)
  const _footerClassName = cx(styles.footer, props.footerClassName)
  const _weekdaysClassName = cx(styles.weekdays, props.weekdaysClassName)
  const _weekdayClassName = cx(styles.weekday, props.weekdayClassName)
  const _captionLabelClassName = cx(styles['caption-label'], props.captionLabelClassName)

  const _monthGridClassName = cx(styles['month-grid'], props.monthGridClassName)
  const _weekClassName = cx(styles.week, props.weekClassName)
  const _dayClassName = cx(styles.day, props.dayClassName)
  const _dayButtonClassName = cx(styles['day-button'], props.dayButtonClassName)

  const buttonRangeClassName = cx(styles['button-range'])
  const _rangeStartClassName = cx(
    buttonRangeClassName,
    styles['range-start'],
    props.rangeStartClassName
  )
  const _rangeEndClassName = cx(buttonRangeClassName, styles['range-end'], props.rangeEndClassName)
  const _rangeMiddleClassName = cx(styles['range-middle'], props.rangeMiddleClassName)
  const _selectedClassName = cx(styles['day-selected'], props.selectedClassName)
  const _todayClassName = cx(styles.today, props.todayClassName)
  const _outsideClassName = cx(styles.outside, props.outsideClassName)
  const _disabledClassName = cx(styles.disabled, props.disabledClassName)
  const _hiddenClassName = cx(styles.hidden, props.hiddenClassName)

  const Dropdown = React.useCallback(
    ({ value, onChange, options }: React.ComponentProps<typeof DropDownDayPicker>) => {
      const selected = options?.find((option) => option.value === value)
      const handleChange = (newValue: string) => {
        const changeEvent = {
          target: { value: newValue },
        } as React.ChangeEvent<HTMLSelectElement>
        onChange?.(changeEvent)
      }
      return (
        <SelectPrimitive.Root
          value={value?.toString()}
          onValueChange={(newValue) => {
            handleChange(newValue as string)
          }}
        >
          <SelectPrimitive.Trigger
            render={
              <Button
                variant="outlined"
                size="sm"
                className={cx(styles['select-trigger'], props.selectTriggerClassName)}
              />
            }
          >
            <SelectPrimitive.Value>{() => selected?.label}</SelectPrimitive.Value>
            <SelectPrimitive.Icon>
              <ChevronsUpDown height="18px" width="18px" svgClassName={styles['select-chevrons']} />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Positioner
              className={styles['select-content']}
              sideOffset={4}
              align="center"
              alignItemWithTrigger={false}
            >
              <SelectPrimitive.Popup>
                <ScrollArea className={cx(styles['scroll-area'])}>
                  <SelectPrimitive.List>
                    {options?.map(({ value, label, disabled }, id) => (
                      <SelectPrimitive.Item
                        className={styles['select-item']}
                        key={`${value}-${id}`}
                        value={value?.toString()}
                        disabled={disabled}
                      >
                        <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
                      </SelectPrimitive.Item>
                    ))}
                  </SelectPrimitive.List>
                </ScrollArea>
              </SelectPrimitive.Popup>
            </SelectPrimitive.Positioner>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
      )
    },
    [props.selectTriggerClassName]
  )

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      hideNavigation={true} // Ensure navigation is hidden
      className={cx(styles['day-picker'], className)}
      classNames={{
        caption_label: _captionLabelClassName,
        day: _dayClassName,
        day_button: _dayButtonClassName,
        dropdowns: _dropdownsClassName,
        footer: _footerClassName,
        month: props.monthClassName,
        month_caption: _monthCaptionClassName,
        month_grid: _monthGridClassName,
        months: _monthsClassName,
        week: _weekClassName,
        weekday: _weekdayClassName,
        weekdays: _weekdaysClassName,
        range_end: _rangeEndClassName,
        range_middle: _rangeMiddleClassName,
        range_start: _rangeStartClassName,
        selected: _selectedClassName,
        disabled: _disabledClassName,
        hidden: _hiddenClassName,
        outside: _outsideClassName,
        today: _todayClassName,
        nav: 'hidden', // This hides the navigation (chevrons)
        ...classNames,
      }}
      components={{
        Dropdown,
        ...customComponents,
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'
