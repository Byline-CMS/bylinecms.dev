import { $generateNodesFromDOM } from '@lexical/html'
import type { LexicalEditor, SerializedEditorState } from 'lexical'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'

export const importHtmlToSerializedEditorState = (
  html: string,
  editor: LexicalEditor
): SerializedEditorState => {
  const parser = new DOMParser()
  const dom = parser.parseFromString(html, 'text/html')

  editor.update(
    () => {
      const nodes = $generateNodesFromDOM(editor, dom)
      const root = $getRoot()
      root.clear()

      if (nodes.length > 0) {
        root.append(...nodes)
        return
      }

      // Never allow an empty root state; fallback to plain text.
      const text = dom.body?.textContent?.trim() ?? ''
      const paragraph = $createParagraphNode()
      if (text.length > 0) {
        paragraph.append($createTextNode(text))
      }
      root.append(paragraph)
    },
    { discrete: true }
  )

  return editor.getEditorState().toJSON()
}
