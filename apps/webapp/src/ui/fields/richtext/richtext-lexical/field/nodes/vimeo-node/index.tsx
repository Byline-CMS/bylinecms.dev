/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type * as React from 'react'

import { BlockWithAlignableContents } from '@lexical/react/LexicalBlockWithAlignableContents'
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from '@lexical/react/LexicalDecoratorBlockNode'
import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementFormatType,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  Spread,
} from 'lexical'

type VimeoComponentProps = Readonly<{
  className: Readonly<{
    base: string
    focus: string
  }>
  format: ElementFormatType | null
  nodeKey: NodeKey
  videoID: string
}>

function VimeoComponent({
  className,
  format,
  nodeKey,
  videoID,
}: VimeoComponentProps): React.JSX.Element {
  return (
    <BlockWithAlignableContents className={className} format={format} nodeKey={nodeKey}>
      <iframe
        style={{
          aspectRatio: '16 / 9',
          width: '100%',
        }}
        src={`https://player.vimeo.com/video/${videoID}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen={true}
        title="Vimeo Video"
      />
    </BlockWithAlignableContents>
  )
}

export type SerializedVimeoNode = Spread<
  {
    videoID: string
  },
  SerializedDecoratorBlockNode
>

function convertVimeoElement(domNode: HTMLElement): null | DOMConversionOutput {
  const videoID = domNode.getAttribute('data-lexical-vimeo')
  if (videoID != null) {
    const node = $createVimeoNode(videoID)
    return { node }
  }
  return null
}

export class VimeoNode extends DecoratorBlockNode {
  __id: string

  static getType(): string {
    return 'vimeo'
  }

  static clone(node: VimeoNode): VimeoNode {
    return new VimeoNode(node.__id, node.__format, node.__key)
  }

  static importJSON(serializedNode: SerializedVimeoNode): VimeoNode {
    const node = $createVimeoNode(serializedNode.videoID)
    node.setFormat(serializedNode.format)
    return node
  }

  exportJSON(): SerializedVimeoNode {
    return {
      ...super.exportJSON(),
      type: 'vimeo',
      version: 1,
      videoID: this.__id,
    }
  }

  constructor(id: string, format?: ElementFormatType, key?: NodeKey) {
    super(format, key)
    this.__id = id
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('iframe')
    element.setAttribute('data-lexical-vimeo', this.__id)
    element.setAttribute('width', '560')
    element.setAttribute('height', '315')
    element.setAttribute('src', `https://player.vimeo.com/video/${this.__id}`)
    element.setAttribute('frameborder', '0')
    element.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture"')
    element.setAttribute('allowfullscreen', 'true')
    element.setAttribute('title', 'Vimeo video')
    return { element }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      iframe: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-vimeo')) {
          return null
        }
        return {
          conversion: convertVimeoElement,
          priority: 1,
        }
      },
    }
  }

  updateDOM(): false {
    return false
  }

  getId(): string {
    return this.__id
  }

  getTextContent(
    _includeInert?: boolean | undefined,
    _includeDirectionless?: false | undefined
  ): string {
    return `https://vimeo.com/${this.__id}`
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock ?? {}
    const className = {
      base: embedBlockTheme.base ?? '',
      focus: embedBlockTheme.focus ?? '',
    }
    return (
      <VimeoComponent
        className={className}
        format={this.__format}
        nodeKey={this.getKey()}
        videoID={this.__id}
      />
    )
  }
}

export function $createVimeoNode(videoID: string): VimeoNode {
  return new VimeoNode(videoID)
}

export function $isVimeoNode(node: VimeoNode | LexicalNode | null | undefined): node is VimeoNode {
  return node instanceof VimeoNode
}
