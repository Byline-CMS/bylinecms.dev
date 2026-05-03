'use client'

import { Fragment } from 'react'

import type { SerializedInlineImageNode, SerializedTextNode } from '@byline/richtext-lexical'
import { Table } from '@infonomic/uikit/react'

import { AdmonitionSerializer } from '../../admonition/index.tsx'
import { CodeSerializer } from '../../code/code-serializer.tsx'
import { HeadingWithAnchorSerializer } from '../../heading-anchor/index.ts'
import { InlineImageSerializer } from '../../inline-image/index.tsx'
import { LayoutContainerSerializer, LayoutItemSerializer } from '../../layout/index.tsx'
import { LinkLexicalSerializer } from '../../link/link-lexical.tsx'
import { ListItemSerializer, ListSerializer } from '../../list/index.ts'
import { TableCellSerializer } from '../../table-cell/index.tsx'
import { VimeoSerializer } from '../../vimeo/index.tsx'
import { YouTubeSerializer } from '../../youtube/index.tsx'
import {
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_SUBSCRIPT,
  IS_SUPERSCRIPT,
  IS_UNDERLINE,
} from './richtext-node-formats.ts'
import type { Locale } from '@/i18n/i18n-config'
import type { SerializedLexicalNode } from './types.ts'

export interface SerializeOptions {
  renderParagraphInline: boolean
  disableAnimation?: boolean
}

export interface SerializeProps {
  nodes: SerializedLexicalNode[]
  lng: Locale
  options?: SerializeOptions
}

export function Serialize({
  nodes,
  lng,
  options = { renderParagraphInline: false },
}: SerializeProps): React.JSX.Element {
  return (
    <Fragment>
      {nodes?.map((node, index): React.JSX.Element | null => {
        if (node.type === 'text') {
          const textNode = node as SerializedTextNode
          const { text, format } = textNode
          if (format & IS_BOLD) {
            return <strong key={index}>{text}</strong>
          }
          if (format & IS_ITALIC) {
            return <em key={index}>{text}</em>
          }
          if (format & IS_STRIKETHROUGH) {
            return (
              <span key={index} className="line-through">
                {text}
              </span>
            )
          }
          if (format & IS_UNDERLINE) {
            return (
              <span key={index} className="underline">
                {text}
              </span>
            )
          }
          if (format & IS_CODE) {
            return <code key={index}>{text}</code>
          }
          if (format & IS_SUBSCRIPT) {
            return <sub key={index}>{text}</sub>
          }
          if (format & IS_SUPERSCRIPT) {
            return <sup key={index}> {text} </sup>
          }
          return <Fragment key={index}>{text}</Fragment>
        }

        if (node == null) {
          return null
        }

        // NOTE: Hacky fix for
        // https://github.com/facebook/lexical/blob/d10c4e6e55261b2fdd7d1845aed46151d0f06a8c/packages/lexical-list/src/LexicalListItemNode.ts#L133
        // which does not return checked: false (only true - i.e. there is no prop for false)
        // NOTE: also 'look ahead' for table rows that should be a header.
        const serializedChildrenFn = (node: SerializedLexicalNode): React.JSX.Element | null => {
          if (node.children == null) {
            return null
          } else {
            if (node?.type === 'list' && node?.listType === 'check') {
              for (const item of node.children) {
                if (!item?.checked) {
                  item.checked = false
                }
              }
              return Serialize({ nodes: node.children, lng, options })
            } else {
              return Serialize({ nodes: node.children, lng, options })
            }
          }
        }

        const serializedChildren = serializedChildrenFn(node)

        switch (node.type) {
          case 'linebreak': {
            return <br key={index} />
          }
          case 'quote': {
            return <blockquote key={index}>{serializedChildren}</blockquote>
          }
          case 'horizontalrule': {
            return (
              <hr
                className="not-prose clear-both my-6 border-gray-300 dark:border-gray-600"
                key={index}
              />
            )
          }
          case 'paragraph': {
            if (options.renderParagraphInline) {
              return <span key={index}>{serializedChildren}</span>
            } else {
              return <p key={index}>{serializedChildren}</p>
            }
          }
          case 'heading': {
            return <HeadingWithAnchorSerializer key={index} node={node} />
          }
          case 'list': {
            return (
              <ListSerializer key={index} node={node}>
                {serializedChildren}
              </ListSerializer>
            )
          }
          case 'listitem': {
            return (
              <ListItemSerializer key={index} node={node}>
                {serializedChildren}
              </ListItemSerializer>
            )
          }
          case 'link': {
            return (
              <LinkLexicalSerializer key={index} attributes={node.attributes} lng={lng}>
                {serializedChildren}
              </LinkLexicalSerializer>
            )
          }
          case 'admonition': {
            return (
              <AdmonitionSerializer
                key={index}
                node={node}
                serialize={Serialize}
                lng={lng}
                options={options}
              />
            )
          }
          case 'inline-image': {
            return (
              <InlineImageSerializer
                key={index}
                node={node as SerializedInlineImageNode}
                serialize={Serialize}
                lng={lng}
                options={options}
              />
            )
          }
          case 'code': {
            return <CodeSerializer key={index} node={node} />
          }
          case 'table': {
            return (
              <Table.Container key={index}>
                <Table>
                  <Table.Body>{serializedChildren}</Table.Body>
                </Table>
              </Table.Container>
            )
          }
          case 'tablerow': {
            return <Table.Row key={index}>{serializedChildren}</Table.Row>
          }
          case 'tablecell': {
            // TODO: revisit - we special case inline images if they appear inside a table
            // cell - and so that's why we're using the TableCellSerializer now
            return (
              <TableCellSerializer
                key={index}
                node={node}
                serialize={Serialize}
                lng={lng}
                options={options}
              />
            )
            // if (node?.headerState === 1 || node?.headerState === 2 || node?.headerState === 3) {
            //   return <TableHeadingCell key={index}>{serializedChildren}</TableHeadingCell>
            // } else {
            //   return <TableCell key={index}>{serializedChildren}</TableCell>
            // }
          }
          case 'layout-container': {
            return (
              <LayoutContainerSerializer
                key={index}
                node={node}
                serialize={Serialize}
                lng={lng}
                options={options}
              />
            )
          }
          case 'layout-item': {
            return (
              <LayoutItemSerializer
                key={index}
                node={node}
                serialize={Serialize}
                lng={lng}
                options={options}
              />
            )
          }
          case 'youtube': {
            return <YouTubeSerializer key={index} node={node} />
          }
          case 'vimeo': {
            return <VimeoSerializer key={index} node={node} />
          }
          // case 'code-highlight': {
          //   return <Fragment key={index}>{`${node.text}\r\n`}</Fragment>
          // }
          default:
            return null
        }
      })}
    </Fragment>
  )
}
