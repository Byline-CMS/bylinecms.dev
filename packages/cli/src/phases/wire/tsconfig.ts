import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { applyEdits, modify, type Node, parse, parseTree } from 'jsonc-parser'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'tsconfig.json'
const PATH_KEY = '~/*'
const PATH_VALUE = ['./byline/*']
const SNIPPET = `// In tsconfig.json, ensure compilerOptions.paths contains the "~/*" alias:
{
  "compilerOptions": {
    "paths": {
      "~/*": ["./byline/*"]
    }
  }
}`

export const wireTsconfig: SubEdit = {
  key: 'tsconfig',
  title: `Add compilerOptions.paths["${PATH_KEY}"] to ${REL}`,
  async preview(ctx) {
    return run(ctx, true)
  },
  async apply(ctx) {
    return run(ctx, false)
  },
}

async function run(ctx: Context, dryRun: boolean): Promise<SubEditResult> {
  const path = ctx.resolve(REL)
  if (!existsSync(path)) {
    return { status: 'blocked', message: `${REL} not found at the project root` }
  }
  const raw = readFileSync(path, 'utf8')

  const errors: import('jsonc-parser').ParseError[] = []
  const parsed = parse(raw, errors, { allowTrailingComma: true }) as
    | { compilerOptions?: { paths?: Record<string, string[]> } }
    | undefined
  if (errors.length > 0 || !parsed) {
    return {
      status: 'manual',
      message: `${REL}: could not parse as JSON / JSONC — please add the path mapping manually`,
      snippet: SNIPPET,
    }
  }

  const existing = parsed.compilerOptions?.paths?.[PATH_KEY]
  if (Array.isArray(existing) && arraysEqual(existing, PATH_VALUE)) {
    return { status: 'skipped', message: `${REL}: ${PATH_KEY} alias already correctly set` }
  }

  // The user has a *different* mapping for `~/*` — refuse to overwrite,
  // bail to manual so they can decide how to reconcile.
  if (existing !== undefined) {
    return {
      status: 'manual',
      message: `${REL}: ${PATH_KEY} is mapped to a different value — refusing to overwrite`,
      snippet: SNIPPET,
    }
  }

  if (dryRun) {
    return { status: 'done', message: `${REL}: will set ${PATH_KEY} → ${PATH_VALUE[0]}` }
  }

  const tree = parseTree(raw, [], { allowTrailingComma: true })
  if (!tree) {
    return {
      status: 'manual',
      message: `${REL}: could not build a syntax tree — please apply manually`,
      snippet: SNIPPET,
    }
  }

  // Inspect what already exists so we can choose the right anchor for `modify`.
  const compilerOptions = findChild(tree, 'compilerOptions')
  const paths = compilerOptions ? findChild(compilerOptions, 'paths') : undefined

  const indentChar = detectIndent(raw)
  const edits = paths
    ? modify(raw, ['compilerOptions', 'paths', PATH_KEY], PATH_VALUE, {
        formattingOptions: { tabSize: indentChar.size, insertSpaces: indentChar.spaces },
      })
    : compilerOptions
      ? modify(
          raw,
          ['compilerOptions', 'paths'],
          { [PATH_KEY]: PATH_VALUE },
          {
            formattingOptions: { tabSize: indentChar.size, insertSpaces: indentChar.spaces },
          }
        )
      : modify(
          raw,
          ['compilerOptions'],
          { paths: { [PATH_KEY]: PATH_VALUE } },
          { formattingOptions: { tabSize: indentChar.size, insertSpaces: indentChar.spaces } }
        )

  const next = applyEdits(raw, edits)
  writeFileSync(path, next, 'utf8')
  return { status: 'done', message: `${REL}: added ${PATH_KEY} → ${PATH_VALUE[0]}` }
}

function findChild(node: Node, key: string): Node | undefined {
  if (node.type !== 'object' || !node.children) return undefined
  for (const prop of node.children) {
    if (prop.type !== 'property' || !prop.children) continue
    const [k, v] = prop.children
    if (k?.value === key) return v
  }
  return undefined
}

function detectIndent(text: string): { size: number; spaces: boolean } {
  // Look at the first indented line.
  const m = text.match(/\n([ \t]+)\S/)
  if (!m) return { size: 2, spaces: true }
  const indent = m[1] as string
  if (indent.startsWith('\t')) return { size: 1, spaces: false }
  return { size: indent.length, spaces: true }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
