import { existsSync, readFileSync } from 'node:fs'

import {
  type ArrayLiteralExpression,
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'src/start.ts'
const ADAPTER_NAME = 'bylineCodedErrorAdapter'
const ADAPTER_MODULE = '@byline/host-tanstack-start/integrations/start-errors'
const SNIPPET = `import { createStart } from '@tanstack/react-start'

import { ${ADAPTER_NAME} } from '${ADAPTER_MODULE}'

export const startInstance = createStart(() => ({
  serializationAdapters: [${ADAPTER_NAME}],
}))
`

export const wireStartTs: SubEdit = {
  key: 'start-ts',
  title: `Register ${ADAPTER_NAME} in ${REL}`,
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
    return { status: 'blocked', message: `${REL} not found — host phase should have caught this` }
  }

  const text = readFileSync(path, 'utf8')
  // Cheap pre-check: if the adapter identifier is already referenced anywhere,
  // assume the wiring is in place. Avoids a full AST round-trip on the common
  // case where wire has already been run.
  if (text.includes(ADAPTER_NAME)) {
    return { status: 'skipped', message: `${REL}: ${ADAPTER_NAME} already registered` }
  }

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  let source: SourceFile
  try {
    source = project.addSourceFileAtPath(path)
  } catch {
    return manualBail(`${REL}: could not parse`)
  }

  const createStartCall = findCreateStartCall(source)
  if (!createStartCall) {
    return manualBail(`${REL}: no \`createStart(...)\` call found`)
  }

  const optionsLiteral = findReturnedOptionsObject(createStartCall)
  if (!optionsLiteral) {
    return manualBail(
      `${REL}: \`createStart\` factory does not return an inline object literal — cannot safely auto-edit`
    )
  }

  if (dryRun) {
    return {
      status: 'done',
      message: `${REL}: will add ${ADAPTER_NAME} to serializationAdapters`,
    }
  }

  ensureImport(source)
  ensureAdapterInOptions(optionsLiteral)
  source.saveSync()

  return { status: 'done', message: `${REL}: registered ${ADAPTER_NAME}` }
}

function manualBail(message: string): SubEditResult {
  return { status: 'manual', message, snippet: SNIPPET }
}

function findCreateStartCall(source: SourceFile): CallExpression | undefined {
  // Walk top-level descendants looking for any `createStart(...)` call.
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (expr.getText() === 'createStart') return call
  }
  return undefined
}

function findReturnedOptionsObject(call: CallExpression): ObjectLiteralExpression | undefined {
  const args = call.getArguments()
  if (args.length === 0) return undefined
  const factory = args[0]
  if (!factory) return undefined

  // Two supported shapes:
  //   createStart(() => ({ ... }))           <- ArrowFunction with parenthesised object body
  //   createStart(() => { return { ... } })  <- ArrowFunction with return statement
  if (Node.isArrowFunction(factory) || Node.isFunctionExpression(factory)) {
    const body = factory.getBody()
    if (Node.isParenthesizedExpression(body)) {
      const inner = body.getExpression()
      if (Node.isObjectLiteralExpression(inner)) return inner
    }
    if (Node.isObjectLiteralExpression(body)) return body
    if (Node.isBlock(body)) {
      const ret = body.getStatements().find(Node.isReturnStatement)
      if (ret) {
        const expr = ret.getExpression()
        if (expr && Node.isObjectLiteralExpression(expr)) return expr
        if (expr && Node.isParenthesizedExpression(expr)) {
          const inner = expr.getExpression()
          if (Node.isObjectLiteralExpression(inner)) return inner
        }
      }
    }
  }
  return undefined
}

function ensureImport(source: SourceFile): void {
  const existing = source
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === ADAPTER_MODULE)
  if (existing) {
    const already = existing.getNamedImports().some((n) => n.getName() === ADAPTER_NAME)
    if (!already) existing.addNamedImport(ADAPTER_NAME)
    return
  }
  // Insert after the last existing import; if none, at the top.
  const imports = source.getImportDeclarations()
  source.insertImportDeclaration(imports.length, {
    moduleSpecifier: ADAPTER_MODULE,
    namedImports: [ADAPTER_NAME],
  })
}

function ensureAdapterInOptions(options: ObjectLiteralExpression): void {
  const prop = options.getProperty('serializationAdapters')
  if (!prop) {
    options.addPropertyAssignment({
      name: 'serializationAdapters',
      initializer: `[${ADAPTER_NAME}]`,
    })
    return
  }
  if (!Node.isPropertyAssignment(prop)) return
  const init = prop.getInitializer()
  if (!init || !Node.isArrayLiteralExpression(init)) return
  ensureAdapterInArray(init)
}

function ensureAdapterInArray(arr: ArrayLiteralExpression): void {
  const already = arr.getElements().some((el) => el.getText() === ADAPTER_NAME)
  if (already) return
  arr.addElement(ADAPTER_NAME)
}
