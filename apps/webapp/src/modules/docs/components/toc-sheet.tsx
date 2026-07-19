'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Narrow-viewport presentation of "On this page": an outlined trigger that
 * opens the contents in a bottom sheet. Above the three-column breakpoint the
 * trigger hides and `DocsToc` shows the same list as a sticky rail — the two
 * presentations share `DocsTocList` and are never visible at once.
 */

import type React from 'react'

import { Button, ChevronDownIcon, Modal, useModal } from '@byline/ui/react'
import cx from 'classnames'

import { DocsTocList } from './toc'
import styles from './toc-sheet.module.css'
import { useActiveHeading } from './use-active-heading'
import type { TocHeading } from '@/modules/docs/toc'

interface DocsTocSheetProps {
  headings: TocHeading[]
  label: string
}

export function DocsTocSheet({ headings, label }: DocsTocSheetProps): React.JSX.Element | null {
  const { isOpen, onOpen, onDismiss } = useModal()
  const activeId = useActiveHeading(headings)

  if (headings.length === 0) return null

  return (
    <>
      <Button
        type="button"
        variant="outlined"
        intent="noeffect"
        size="sm"
        className={cx('byline-docs-toc-sheet-trigger', styles.trigger)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        {label}
        <span
          aria-hidden="true"
          className={cx('byline-docs-toc-sheet-trigger-icon', styles.triggerIcon, {
            'byline-docs-toc-sheet-trigger-icon-open': isOpen,
            [styles.triggerIconOpen]: isOpen,
          })}
        >
          <ChevronDownIcon width="16px" height="16px" />
        </span>
      </Button>

      <Modal isOpen={isOpen} onDismiss={onDismiss} closeOnOverlayClick>
        <Modal.Container className={cx('byline-docs-toc-sheet', styles.sheet)}>
          <Modal.Header className={cx('byline-docs-toc-sheet-header', styles.sheetHeader)}>
            {label}
          </Modal.Header>
          <Modal.Content className={cx('byline-docs-toc-sheet-content', styles.sheetContent)}>
            {/* Dismiss on choose: the sheet covers the very content the reader
                is navigating to, so it has to get out of the way. */}
            <DocsTocList headings={headings} activeId={activeId} onNavigate={onDismiss} />
          </Modal.Content>
        </Modal.Container>
      </Modal>
    </>
  )
}
