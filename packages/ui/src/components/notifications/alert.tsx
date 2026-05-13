'use client'

import type React from 'react'
import { useEffect, useState } from 'react'

import cx from 'classnames'

import { CloseIcon } from '../../icons/close-icon'
import { DangerIcon } from '../../icons/danger-icon'
import { InfoIcon } from '../../icons/info-icon'
import { SuccessIcon } from '../../icons/success-icon'
import { WarningIcon } from '../../icons/warning-icon'
import { Button } from '../button/button.js'
import styles from './alert.module.css'
import type { Intent } from './@types/alert.js'

export interface AlertProps {
  intent?: Intent
  icon?: boolean
  close?: boolean
  className?: string
  title?: string
  children: React.ReactNode
}

const alertIcons = {
  primary: WarningIcon,
  secondary: InfoIcon,
  success: SuccessIcon,
  info: InfoIcon,
  warning: WarningIcon,
  danger: DangerIcon,
}

export const Alert = function Alert({
  ref,
  intent = 'success',
  icon = true,
  close = true,
  title,
  className,
  children,
  ...rest
}: AlertProps & {
  ref?: React.RefObject<HTMLDivElement>
}): React.JSX.Element | null {
  const [show, setShow] = useState(true)
  const [fade, setFade] = useState(false)

  const Icon = alertIcons[intent as keyof typeof alertIcons]

  const handleOnClose = (): void => {
    setFade(true)
    setTimeout(() => setShow(false), 400) // Match the CSS transition duration
  }

  useEffect(() => {
    if (!show) {
      // Perform any cleanup if necessary
    }
  }, [show])

  if (show === false) return null

  return (
    <div
      ref={ref}
      className={cx(
        'byline-alert',
        `byline-alert-${intent}`,
        styles.alert,
        styles[intent],
        className,
        {
          [styles.fade]: fade,
        }
      )}
      {...rest}
    >
      {title != null ? (
        <div className={cx('byline-alert-with-title', styles['alert-with-title'])}>
          <div className={cx('byline-alert-header', styles.header)}>
            {icon && <Icon className={cx('byline-alert-icon', styles.icon)} />}
            <div className={cx('byline-alert-title', styles.title)}>
              <span>{title}</span>
            </div>
            {close === true && (
              <Button
                intent={intent}
                variant="filled"
                aria-label="Close"
                className={cx('byline-alert-close', styles.close)}
                type="button"
                onClick={handleOnClose}
                {...rest}
              >
                <CloseIcon height="12px" width="12px" />
              </Button>
            )}
          </div>
          <div className={cx('byline-alert-content', styles.content)}>{children}</div>
        </div>
      ) : (
        <>
          {icon && <Icon className={cx('byline-alert-icon', styles.icon)} />}
          <div className={cx('byline-alert-content', styles.content)}>{children}</div>
          {close === true && (
            <Button
              intent={intent}
              variant="filled"
              aria-label="Close"
              className={cx('byline-alert-close', styles.close)}
              type="button"
              onClick={handleOnClose}
              {...rest}
            >
              <CloseIcon height="12px" width="12px" />
            </Button>
          )}
        </>
      )}
    </div>
  )
}
