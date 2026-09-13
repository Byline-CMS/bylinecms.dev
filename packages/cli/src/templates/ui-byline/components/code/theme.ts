import type { PrismTheme } from 'prism-react-renderer'

// Stable on the server and client. CSS selects the One Light / One Dark
// palette using the document class set by the existing early theme detector.
export const codeTheme: PrismTheme = {
  plain: {
    color: 'var(--code-text)',
    backgroundColor: 'var(--code-background)',
  },
  styles: [
    { types: ['comment', 'prolog', 'cdata'], style: { color: 'var(--code-comment)' } },
    { types: ['doctype', 'entity'], style: { color: 'var(--code-text)' } },
    { types: ['punctuation'], style: { color: 'var(--code-punctuation)' } },
    {
      types: ['attr-name', 'class-name', 'boolean', 'constant', 'number', 'atrule'],
      style: { color: 'var(--code-literal)' },
    },
    { types: ['maybe-class-name'], style: { color: 'var(--code-maybe-class)' } },
    { types: ['keyword'], style: { color: 'var(--code-keyword)' } },
    { types: ['property', 'tag', 'symbol', 'deleted'], style: { color: 'var(--code-property)' } },
    {
      types: ['selector', 'string', 'char', 'builtin', 'inserted', 'regex', 'attr-value'],
      style: { color: 'var(--code-string)' },
    },
    { types: ['variable', 'operator', 'function'], style: { color: 'var(--code-function)' } },
    { types: ['url'], style: { color: 'var(--code-url)' } },
    { types: ['deleted'], style: { textDecorationLine: 'line-through' } },
    { types: ['inserted'], style: { textDecorationLine: 'underline' } },
    { types: ['italic'], style: { fontStyle: 'italic' } },
    { types: ['important', 'bold'], style: { fontWeight: 'bold' } },
    { types: ['important'], style: { color: 'var(--code-text)' } },
  ],
}
