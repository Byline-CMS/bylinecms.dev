'use client'

import type React from 'react'
import { useEffect, useState } from 'react'

import cx from 'classnames'

import { Checkbox } from './checkbox.jsx'
import styles from './checkbox-group.module.css'

export interface CheckboxGroupProps {
  groupName: string
  className?: string
  checkBoxClasses?: string
  checkBoxes: { id: string; label: string }[]
  defaultValues?: string[]
  controlledValue?: string
  disabled?: boolean
  onChange?: (selectedRoles: string[]) => void
}

export const CheckboxGroup: React.FC<CheckboxGroupProps> = ({
  groupName,
  className,
  checkBoxClasses,
  checkBoxes,
  defaultValues,
  controlledValue,
  disabled = false,
  onChange,
}) => {
  let initialValue: string[] = []
  if (controlledValue !== undefined && controlledValue.length > 0) {
    initialValue = controlledValue.split(',')
  } else if (defaultValues !== undefined) {
    initialValue = defaultValues
  }

  const [selected, setSelected] = useState<string[]>(initialValue)

  // We have to call setSelected here in useEffect to
  // synchronize controlledValue - we can't rely on
  // initialValue alone
  useEffect(() => {
    if (controlledValue !== undefined && controlledValue.length > 0) {
      setSelected(controlledValue.split(','))
    } else if (defaultValues !== undefined) {
      setSelected(defaultValues)
    } else {
      setSelected([])
    }
  }, [controlledValue, defaultValues])

  const handleCheckboxChange = (id: string, checked: boolean) => {
    const s = [...selected]
    if (checked === true) {
      if (s.includes(id) === false) {
        s.push(id)
      }
    } else {
      const index = s.indexOf(id)
      if (index !== -1) {
        s.splice(index, 1)
      }
    }
    setSelected(s)
    onChange?.(s)
  }

  return (
    <div className={cx('byline-checkbox-group', styles['checkbox-group'], className)}>
      {checkBoxes.map((cb) => (
        <Checkbox
          key={cb.id}
          id={`${groupName}-${cb.id}`}
          name={`${groupName}-${cb.id}`}
          label={cb.label}
          checkBoxClasses={checkBoxClasses}
          checked={selected.includes(cb.id)}
          disabled={disabled}
          onCheckedChange={(checked) => handleCheckboxChange(cb.id, checked)}
        />
      ))}
    </div>
  )
}
