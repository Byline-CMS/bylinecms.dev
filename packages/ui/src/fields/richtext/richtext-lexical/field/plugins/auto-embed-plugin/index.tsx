'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type * as React from 'react'
import { useState } from 'react'

import {
  AutoEmbedOption,
  type EmbedConfig,
  type EmbedMatchResult,
  LexicalAutoEmbedPlugin,
} from '@lexical/react/LexicalAutoEmbedPlugin'
import type { LexicalEditor } from 'lexical'
import * as ReactDOM from 'react-dom'

import { INSERT_VIMEO_COMMAND } from '../vimeo-plugin'
import { INSERT_YOUTUBE_COMMAND } from '../youtube-plugin'

// import { INSERT_FIGMA_COMMAND } from '../FigmaPlugin'
// import { INSERT_TWEET_COMMAND } from '../TwitterPlugin'

import { AutoEmbedModal } from './auto-embed-modal'

export interface AutoEmbedConfig extends EmbedConfig {
  // Human readable name of the embedded content e.g. Tweet or Google Map.
  contentName: string

  // Icon for display.
  icon?: React.JSX.Element

  // An example of a matching url https://twitter.com/jack/status/20
  exampleUrl: string

  // For extra searching.
  keywords: string[]

  // Embed a Figma Project.
  description?: string
}

export const YoutubeEmbedConfig: AutoEmbedConfig = {
  contentName: 'Youtube Video',

  exampleUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',

  // Icon for display.
  icon: <i className="icon youtube" />,

  insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
    editor.dispatchCommand(INSERT_YOUTUBE_COMMAND, result.id)
  },

  keywords: ['youtube', 'video'],

  // Determine if a given URL is a match and return url data.
  parseUrl: async (url: string) => {
    const match = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/.exec(url)

    const id = match != null ? (match?.[2].length === 11 ? match[2] : null) : null

    if (id != null) {
      return {
        id,
        url,
      }
    }

    return null
  },

  type: 'youtube-video',
}

export const VimeoEmbedConfig: AutoEmbedConfig = {
  contentName: 'Vimeo Video',

  exampleUrl: 'https://vimeo.com/584985260',

  // Icon for display.
  icon: <i className="icon vimeo" />,

  insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
    editor.dispatchCommand(INSERT_VIMEO_COMMAND, result.id)
  },

  keywords: ['vimeo', 'video'],

  // Determine if a given URL is a match and return url data.
  parseUrl: async (url: string) => {
    const match = /https:\/\/vimeo\.com\/(\d{5,10})/.exec(url)
    const id = match != null ? match[1] : null
    if (id != null) {
      return {
        id,
        url,
      }
    }

    return null
  },

  type: 'vimeo-video',
}

// export const TwitterEmbedConfig: AutoEmbedConfig = {
//   // e.g. Tweet or Google Map.
//   contentName: 'Tweet',

//   exampleUrl: 'https://twitter.com/jack/status/20',

//   // Icon for display.
//   icon: <i className="icon tweet" />,

//   // Create the Lexical embed node from the url data.
//   insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
//     editor.dispatchCommand(INSERT_TWEET_COMMAND, result.id)
//   },

//   // For extra searching.
//   keywords: ['tweet', 'twitter'],

//   // Determine if a given URL is a match and return url data.
//   parseUrl: (text: string) => {
//     const match = /^https:\/\/(twitter|x)\.com\/(#!\/)?(\w+)\/status(es)*\/(\d+)/.exec(text)

//     if (match != null) {
//       return {
//         id: match[5],
//         url: match[1]
//       }
//     }

//     return null
//   },

//   type: 'tweet'
// }

// export const FigmaEmbedConfig: AutoEmbedConfig = {
//   contentName: 'Figma Document',

//   exampleUrl: 'https://www.figma.com/file/LKQ4FJ4bTnCSjedbRpk931/Sample-File',

//   icon: <i className="icon figma" />,

//   insertNode: (editor: LexicalEditor, result: EmbedMatchResult) => {
//     editor.dispatchCommand(INSERT_FIGMA_COMMAND, result.id)
//   },

//   keywords: ['figma', 'figma.com', 'mock-up'],

//   // Determine if a given URL is a match and return url data.
//   parseUrl: (text: string) => {
//     const match =
//       /https:\/\/([\w.-]+\.)?figma.com\/(file|proto)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$/.exec(text)

//     if (match != null) {
//       return {
//         id: match[3],
//         url: match[0]
//       }
//     }

//     return null
//   },

//   type: 'figma'
// }

// export const EmbedConfigs = [TwitterEmbedConfig, YoutubeEmbedConfig, FigmaEmbedConfig]
export const EmbedConfigs = [YoutubeEmbedConfig, VimeoEmbedConfig]

function AutoEmbedMenuItem({
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: {
  index: number
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  option: AutoEmbedOption
}): React.JSX.Element {
  let className = 'item'
  if (isSelected) {
    className += ' selected'
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <li
      key={option.key}
      className={className}
      ref={option.setRefElement}
      id={`typeahead-item-${index}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      onKeyDown={handleKeyDown} // Added keyboard support
    >
      <span className="text">{option.title}</span>
    </li>
  )
}

function AutoEmbedMenu({
  options,
  selectedItemIndex,
  onOptionClick,
  onOptionMouseEnter,
}: {
  selectedItemIndex: number | null
  onOptionClick: (option: AutoEmbedOption, index: number) => void
  onOptionMouseEnter: (index: number) => void
  options: AutoEmbedOption[]
}): React.JSX.Element {
  return (
    <div className="typeahead-popover">
      <ul>
        {options.map((option: AutoEmbedOption, i: number) => (
          <AutoEmbedMenuItem
            index={i}
            isSelected={selectedItemIndex === i}
            onClick={() => {
              onOptionClick(option, i)
            }}
            onMouseEnter={() => {
              onOptionMouseEnter(i)
            }}
            key={option.key}
            option={option}
          />
        ))}
      </ul>
    </div>
  )
}

export function AutoEmbedPlugin(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [embedConfig, setEmbedConfig] = useState<AutoEmbedConfig | null>(null)

  const handleOnOpenEmbedModalForConfig = (config: AutoEmbedConfig): void => {
    setEmbedConfig(config)
    setOpen(true)
  }

  const getMenuOptions = (
    activeEmbedConfig: AutoEmbedConfig,
    embedFn: () => void,
    dismissFn: () => void
  ): AutoEmbedOption[] => {
    return [
      new AutoEmbedOption('Dismiss', {
        onSelect: dismissFn,
      }),
      new AutoEmbedOption(`Embed ${activeEmbedConfig.contentName}`, {
        onSelect: embedFn,
      }),
    ]
  }

  return (
    <>
      <LexicalAutoEmbedPlugin<AutoEmbedConfig>
        embedConfigs={EmbedConfigs}
        onOpenEmbedModalForConfig={handleOnOpenEmbedModalForConfig}
        getMenuOptions={getMenuOptions}
        menuRenderFn={(
          anchorElementRef,
          { selectedIndex, options, selectOptionAndCleanUp, setHighlightedIndex }
        ) =>
          anchorElementRef.current != null
            ? ReactDOM.createPortal(
                <div
                  className="typeahead-popover auto-embed-menu"
                  style={{
                    marginLeft: anchorElementRef.current.style.width,
                    width: 200,
                  }}
                >
                  <AutoEmbedMenu
                    options={options}
                    selectedItemIndex={selectedIndex}
                    onOptionClick={(option: AutoEmbedOption, index: number) => {
                      setHighlightedIndex(index)
                      selectOptionAndCleanUp(option)
                    }}
                    onOptionMouseEnter={(index: number) => {
                      setHighlightedIndex(index)
                    }}
                  />
                </div>,
                anchorElementRef.current
              )
            : null
        }
      />
      <AutoEmbedModal
        open={open}
        embedConfig={embedConfig as AutoEmbedConfig}
        onClose={() => {
          setOpen(false)
          setEmbedConfig(null)
        }}
      />
    </>
  )
}
