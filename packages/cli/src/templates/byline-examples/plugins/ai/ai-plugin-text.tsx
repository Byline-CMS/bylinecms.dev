'use client'

import type * as React from 'react'
import { useCallback, useState } from 'react'

import { AiPluginText as AiPluginTextRoot } from '@byline/ai/plugins/text'
import { AiIcon, IconButton, Input } from '@byline/ui/react'

export function AiPluginText() {
  const [inputText, setInputText] = useState('')
  const [open, setOpen] = useState(false)

  const handleToggleOpen = useCallback(() => {
    setOpen((prevOpen) => !prevOpen)
  }, [])

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value)
  }, [])

  const handleApplyResult = useCallback((nextText: string) => {
    setInputText(nextText)
  }, [])

  const handleClearInput = useCallback(() => {
    setInputText('')
  }, [])

  return (
    <div className="ai-plugin-text">
      <IconButton
        onClick={handleToggleOpen}
        variant="text"
        size="md"
        className="w-7 h-7 max-w-7 max-h-7 min-w-7 min-h-7"
      >
        <AiIcon />
      </IconButton>
      <Input
        id="foo"
        name="foo"
        label="Simple Text Input"
        type="text"
        onChange={handleInputChange}
        value={inputText}
        helpText="Enter some text, or enter a prompt below to generate text."
        placeholder="Start writing your content here..."
      />
      <AiPluginTextRoot
        inputText={inputText}
        onApplyResult={handleApplyResult}
        onClearInput={handleClearInput}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  )
}
