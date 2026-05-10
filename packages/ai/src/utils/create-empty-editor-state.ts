/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  SerializedEditorState,
  SerializedLexicalNode,
  SerializedParagraphNode,
  SerializedRootNode,
} from 'lexical'

/**
 * createEmptyEditorState
 * @returns 
 * "root": {
        "children": [{
                "children": [],
                "direction": null,
                "format": "",
                "indent": 0,
                "type": "paragraph",
                "version": 1,
                "textFormat": 0,
                "textStyle": ""
            }
        ],
        "direction": null,
        "format": "",
        "indent": 0,
        "type": "root",
        "version": 1
    }
 */
export function createEmptyEditorState(): SerializedEditorState<SerializedLexicalNode> {
  const emptyParagraphNode: SerializedParagraphNode = {
    children: [],
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  }

  const rootNode: SerializedRootNode = {
    children: [emptyParagraphNode],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  }

  return { root: rootNode }
}
