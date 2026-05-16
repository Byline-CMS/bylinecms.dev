'use client'

import * as React from 'react'
import { useEffect } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_NORMAL, createCommand } from 'lexical'

import { TableModal } from './table-modal'

export const OPEN_TABLE_MODAL_COMMAND = createCommand('OPEN_TABLE_MODAL_COMMAND')

export function TablePlugin(): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = React.useState(false)

  useEffect(() => {
    return editor.registerCommand<null>(
      OPEN_TABLE_MODAL_COMMAND,
      () => {
        setOpen((prev) => (prev ? prev : true))
        return true
      },
      COMMAND_PRIORITY_NORMAL
    )
  }, [editor])

  const handleOnClose = (): void => {
    setOpen(false)
  }

  return <TableModal open={open} onClose={handleOnClose} />
}
