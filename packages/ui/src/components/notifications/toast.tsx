'use client'

import React from 'react'

import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import cx from 'classnames'

import { CloseIcon } from '../../icons/close-icon'
import { DangerIcon } from '../../icons/danger-icon'
import { InfoIcon } from '../../icons/info-icon'
import { SuccessIcon } from '../../icons/success-icon'
import { WarningIcon } from '../../icons/warning-icon'
import { Button } from '../button/button.js'
import styles from './toast.module.css'
import type { Position, ToastData } from './@types/toast.js'

const toastIcons = {
  success: SuccessIcon,
  info: InfoIcon,
  warning: WarningIcon,
  danger: DangerIcon,
}

// Re-export Base UI toast utilities
export const useToastManager = ToastPrimitive.useToastManager<ToastData>
export const createToastManager = ToastPrimitive.createToastManager<ToastData>

export interface ToastProviderProps {
  children: React.ReactNode
  timeout?: number
  limit?: number
  toastManager?: ReturnType<typeof createToastManager>
}

export function ToastProvider({
  children,
  timeout = 5000,
  limit = 3,
  toastManager,
}: ToastProviderProps) {
  return (
    <ToastPrimitive.Provider timeout={timeout} limit={limit} toastManager={toastManager}>
      {children}
    </ToastPrimitive.Provider>
  )
}

export interface ToastViewportProps {
  position?: Position
  className?: string
}

export function ToastViewport({ position = 'bottom-right', className }: ToastViewportProps) {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>()
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        className={cx('byline-toast-viewport', styles.viewport, styles[position], className)}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

function ToastItem({ toast }: { toast: ToastPrimitive.Root.ToastObject<ToastData> }) {
  const { intent = 'success', iconType = 'success', icon = true, close = true } = toast.data ?? {}
  const eventDateRef = React.useRef(new Date())
  const Icon = toastIcons[iconType as keyof typeof toastIcons]

  const swipeDirection = React.useMemo<
    React.ComponentProps<typeof ToastPrimitive.Root>['swipeDirection']
  >(() => ['down', 'right'], [])

  return (
    <ToastPrimitive.Root
      toast={toast}
      swipeDirection={swipeDirection}
      className={cx('byline-toast', styles.root)}
    >
      <ToastPrimitive.Content className={cx('byline-toast-content', styles.content)}>
        <div className={cx('byline-toast-header', styles.header)}>
          <time dateTime={eventDateRef.current.toISOString()} className="text-sm">
            {new Intl.DateTimeFormat('default', {
              hour12: true,
              hour: 'numeric',
              minute: 'numeric',
            }).format(eventDateRef.current)}
          </time>
          {close && (
            <ToastPrimitive.Close
              render={
                <Button
                  intent={intent}
                  tabIndex={0}
                  variant="filled"
                  aria-label="Close"
                  className={cx('byline-toast-close', styles.close)}
                  type="button"
                />
              }
            >
              <CloseIcon height="12px" width="12px" />
            </ToastPrimitive.Close>
          )}
        </div>
        <ToastPrimitive.Title className={cx('byline-toast-title', styles.title)}>
          {icon && Icon && <Icon />}
          {toast.title}
        </ToastPrimitive.Title>
        <ToastPrimitive.Description className={cx('byline-toast-description', styles.description)}>
          {toast.description}
        </ToastPrimitive.Description>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  )
}
