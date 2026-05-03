'use client'

import type React from 'react'

import { Radio } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import cx from 'classnames'

import styles from './radio-group.module.css'
import type { Intent } from '../@types/shared'

export interface RadioGroupValue {
  id: string
  value: string
  label: string
}

export const RadioGroupItem = ({
  intent = 'primary',
  className,
  id,
  value,
  label,
  ref: forwardedRef,
  ...props
}: Omit<React.ComponentProps<typeof Radio.Root>, 'value'> & {
  intent?: Intent
  className?: string
  id: string
  value: string
  label: string
  ref?: React.RefObject<HTMLDivElement>
}) => {
  return (
    <div ref={forwardedRef} className={styles['item-container']}>
      <Radio.Root
        {...props}
        className={cx(styles.item, styles[intent])}
        value={value}
        id={id}
        nativeButton
        render={<button type="button" />}
      >
        <Radio.Indicator className={styles.indicator} />
      </Radio.Root>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
    </div>
  )
}

export const RadioGroup = ({
  ref: forwardedRef,
  className,
  direction = 'column',
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive> & {
  direction?: 'row' | 'column'
  className?: string
  children: React.ReactNode
  ref?: React.RefObject<HTMLDivElement>
}) => (
  <RadioGroupPrimitive
    ref={forwardedRef}
    className={cx('infonomic-radio-group', styles[direction], className)}
    {...props}
  >
    {children}
  </RadioGroupPrimitive>
)
