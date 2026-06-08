/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/**
 * Byline markdown transformers.
 *
 * Extends the stock `@lexical/markdown` `TRANSFORMERS` with handlers for
 * Byline's custom nodes, so the document-level markdown toggle (and the
 * inline markdown-shortcut plugin) round-trip them instead of dropping
 * them. The `TABLE` transformer is adapted from the Lexical playground's
 * `MarkdownTransformers` (GFM pipe tables).
 *
 * Used in the browser editor only (the toggle + shortcuts). Server-side
 * markdown export walks the serialized JSON via its own serializer and
 * does not use this module.
 */

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  type MultilineElementTransformer,
  TEXT_FORMAT_TRANSFORMERS,
  TRANSFORMERS,
  type Transformer,
} from '@lexical/markdown'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table'
import { $isParagraphNode, $isTextNode } from 'lexical'

import {
  $createAdmonitionNode,
  $isAdmonitionNode,
  AdmonitionNode,
} from '../extensions/admonition/admonition-node'
import type { AdmonitionType } from '../extensions/admonition/node-types'

// A markdown table row: | a | b | c |
const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/
// The header separator row: | --- | :--: | ---: |  (0.44's @lexical/markdown
// does not export isTableRowDivider, so inline it).
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-+:? ?)+\|?\s?$/

function isTableRowDivider(row: string): boolean {
  return TABLE_ROW_DIVIDER_REG_EXP.test(row)
}

export const TABLE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node) => {
    if (!$isTableNode(node)) {
      return null
    }

    const output: string[] = []

    for (const row of node.getChildren()) {
      const rowOutput: string[] = []
      if (!$isTableRowNode(row)) {
        continue
      }

      let isHeaderRow = false
      for (const cell of row.getChildren()) {
        if ($isTableCellNode(cell)) {
          // Cell content is itself markdown; escape literal newlines so the
          // row stays on one line.
          rowOutput.push(
            $convertToMarkdownString(BYLINE_TRANSFORMERS, cell).replace(/\n/g, '\\n').trim()
          )
          if (cell.hasHeaderState(TableCellHeaderStates.ROW)) {
            isHeaderRow = true
          }
        }
      }

      output.push(`| ${rowOutput.join(' | ')} |`)
      if (isHeaderRow) {
        output.push(`| ${rowOutput.map(() => '---').join(' | ')} |`)
      }
    }

    return output.join('\n')
  },
  regExp: TABLE_ROW_REG_EXP,
  replace: (parentNode, _children, match) => {
    // Header divider row: promote the previous table's last row to headers.
    if (isTableRowDivider(match[0])) {
      const table = parentNode.getPreviousSibling()
      if (!table || !$isTableNode(table)) {
        return
      }

      const rows = table.getChildren()
      const lastRow = rows[rows.length - 1]
      if (!lastRow || !$isTableRowNode(lastRow)) {
        return
      }

      lastRow.getChildren().forEach((cell) => {
        if (!$isTableCellNode(cell)) {
          return
        }
        cell.setHeaderStyles(TableCellHeaderStates.ROW, TableCellHeaderStates.ROW)
      })

      parentNode.remove()
      return
    }

    const matchCells = mapToTableCells(match[0])
    if (matchCells == null) {
      return
    }

    const rows = [matchCells]
    let sibling = parentNode.getPreviousSibling()
    let maxCells = matchCells.length

    // Walk backwards over preceding single-text paragraphs that are also
    // table rows, accumulating them into this table.
    while (sibling) {
      if (!$isParagraphNode(sibling)) {
        break
      }
      if (sibling.getChildrenSize() !== 1) {
        break
      }
      const firstChild = sibling.getFirstChild()
      if (!$isTextNode(firstChild)) {
        break
      }
      const cells = mapToTableCells(firstChild.getTextContent())
      if (cells == null) {
        break
      }
      maxCells = Math.max(maxCells, cells.length)
      rows.unshift(cells)
      const previousSibling = sibling.getPreviousSibling()
      sibling.remove()
      sibling = previousSibling
    }

    const table = $createTableNode()

    for (const cells of rows) {
      const tableRow = $createTableRowNode()
      table.append(tableRow)
      for (let i = 0; i < maxCells; i++) {
        tableRow.append(i < cells.length ? cells[i] : $createTableCell(''))
      }
    }

    const previousSibling = parentNode.getPreviousSibling()
    if ($isTableNode(previousSibling) && getTableColumnsSize(previousSibling) === maxCells) {
      previousSibling.append(...table.getChildren())
      parentNode.remove()
    } else {
      parentNode.replace(table)
    }

    table.selectEnd()
  },
  type: 'element',
}

function getTableColumnsSize(table: TableNode): number {
  const row = table.getFirstChild()
  return $isTableRowNode(row) ? row.getChildrenSize() : 0
}

const $createTableCell = (textContent: string): TableCellNode => {
  const content = textContent.replace(/\\n/g, '\n')
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
  $convertFromMarkdownString(content, BYLINE_TRANSFORMERS, cell)
  return cell
}

const mapToTableCells = (textContent: string): Array<TableCellNode> | null => {
  const match = textContent.match(TABLE_ROW_REG_EXP)
  if (!match?.[1]) {
    return null
  }
  return match[1].split('|').map((text) => $createTableCell(text))
}

// ---------------------------------------------------------------------------
// Admonitions  →  Docusaurus directive syntax:  :::type[Title] … :::
//
// AdmonitionNode is a DecoratorNode whose body is a *nested* LexicalEditor
// (a bare `createEditor()` — paragraph/text/linebreak only). So the body is
// converted with an inline-only transformer set that matches what the nested
// editor can hold; block constructs in the body are intentionally not
// round-tripped because the node can't represent them anyway.
// ---------------------------------------------------------------------------

const ADMONITION_TYPES: ReadonlySet<string> = new Set(['note', 'tip', 'warning', 'danger'])
const ADMONITION_START_REG_EXP = /^:::(note|tip|warning|danger)(?:\[([^\]]*)\])?\s*$/
const ADMONITION_END_REG_EXP = /^:::\s*$/

// Inline-only — the nested admonition editor has no block nodes beyond the
// default paragraph, so importing headings/lists/tables into it would fail.
const ADMONITION_BODY_TRANSFORMERS: Array<Transformer> = [...TEXT_FORMAT_TRANSFORMERS]

export const ADMONITION: MultilineElementTransformer = {
  dependencies: [AdmonitionNode],
  export: (node) => {
    if (!$isAdmonitionNode(node)) {
      return null
    }
    const type = node.getAdmonitionType()
    const title = node.getTitle()

    // Convert the nested editor's content to markdown in its own read context.
    let body = ''
    node.__content.read(() => {
      body = $convertToMarkdownString(ADMONITION_BODY_TRANSFORMERS).trim()
    })

    const heading = title ? `:::${type}[${title}]` : `:::${type}`
    return body ? `${heading}\n${body}\n:::` : `${heading}\n:::`
  },
  regExpStart: ADMONITION_START_REG_EXP,
  // `optional` is required for the as-you-type shortcut path to run this
  // transformer at all: runMultilineElementTransformers skips any multiline
  // transformer whose regExpEnd is non-optional (the closing ::: hasn't been
  // typed yet when the start line fires). The toggle/import path still honours
  // the explicit ::: end when present, falling back to EOF only if it's absent.
  regExpEnd: { optional: true, regExp: ADMONITION_END_REG_EXP },
  replace: (rootNode, children, startMatch, _endMatch, linesInBetween) => {
    const rawType = startMatch[1]
    if (!ADMONITION_TYPES.has(rawType)) {
      return false
    }
    const admonitionType = rawType as AdmonitionType
    const title = startMatch[2] ?? ''

    const node = $createAdmonitionNode({ admonitionType, title })

    // Import path: body arrives as the lines between the fences. Populate the
    // nested editor synchronously so it's flushed before render/serialize.
    if (!children && linesInBetween != null) {
      const body = linesInBetween.join('\n').trim()
      if (body) {
        node.__content.update(
          () => {
            $convertFromMarkdownString(body, ADMONITION_BODY_TRANSFORMERS)
          },
          { discrete: true }
        )
      }
    }

    rootNode.append(node)
  },
  type: 'multiline-element',
}

/**
 * Stock transformers plus Byline's custom-node handlers. Self-referenced by
 * the `TABLE` transformer (cells are converted with the same set), so it
 * must be declared after `TABLE` — the references live inside callbacks that
 * run well after module init, so there is no TDZ hazard.
 */
export const BYLINE_TRANSFORMERS: Array<Transformer> = [TABLE, ADMONITION, ...TRANSFORMERS]
