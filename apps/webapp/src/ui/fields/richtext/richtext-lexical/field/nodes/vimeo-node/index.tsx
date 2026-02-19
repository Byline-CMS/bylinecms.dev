/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
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
