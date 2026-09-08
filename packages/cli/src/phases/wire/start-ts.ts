import { existsSync } from 'node:fs'

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
const SNIPPET = `import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { ${ADAPTER_NAME} } from '${ADAPTER_MODULE}'
import { passwordSignInMiddleware } from '@byline/host-tanstack-start/integrations/sign-in-middleware'

export const startInstance = createStart(() => ({
  serializationAdapters: [${ADAPTER_NAME}],
  requestMiddleware: [createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }), passwordSignInMiddleware],
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

  const middlewareProp = optionsLiteral.getProperty('requestMiddleware')
  if (
    middlewareProp &&
    (!Node.isPropertyAssignment(middlewareProp) ||
      !Node.isArrayLiteralExpression(middlewareProp.getInitializer()))
  ) {
    return manualBail(`${REL}: requestMiddleware must be an inline array for safe editing`)
  }
  const arr =
    middlewareProp && Node.isPropertyAssignment(middlewareProp)
      ? middlewareProp.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression)
      : undefined
  const hasCsrf =
    arr?.getElements().some((el) => {
      const expression = Node.isIdentifier(el)
        ? source.getVariableDeclaration(el.getText())?.getInitializer()
        : el
      return (
        expression &&
        Node.isCallExpression(expression) &&
        expression.getExpression().getText() === 'createCsrfMiddleware'
      )
    }) ?? false
  const hasBodyGuard =
    arr?.getElements().some((el) => el.getText() === 'passwordSignInMiddleware') ?? false
  const adapterProp = optionsLiteral.getProperty('serializationAdapters')
  const hasAdapter =
    adapterProp &&
    Node.isPropertyAssignment(adapterProp) &&
    adapterProp
      .getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
      ?.getElements()
      .some((el) => el.getText() === ADAPTER_NAME)
  if (hasCsrf && hasBodyGuard && hasAdapter) {
    return {
      status: 'skipped',
      message: `${REL}: sign-in protection and error serialization already registered`,
    }
  }
  if (dryRun) {
    return {
      status: 'done',
      message: `${REL}: will register sign-in protection and error serialization`,
    }
  }

  ensureImport(source)
  for (const [moduleSpecifier, name] of [
    ['@byline/host-tanstack-start/integrations/sign-in-middleware', 'passwordSignInMiddleware'],
    ['@tanstack/react-start', 'createCsrfMiddleware'],
  ]) {
    const declaration = source
      .getImportDeclarations()
      .find((d) => d.getModuleSpecifierValue() === moduleSpecifier)
    if (!declaration)
      source.addImportDeclaration({ moduleSpecifier: moduleSpecifier!, namedImports: [name!] })
    else if (!declaration.getNamedImports().some((n) => n.getText() === name))
      declaration.addNamedImport(name!)
  }
  const csrf = "createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })"
  if (!arr) {
    optionsLiteral.addPropertyAssignment({
      name: 'requestMiddleware',
      initializer: `[${csrf}, passwordSignInMiddleware]`,
    })
  } else {
    if (!hasCsrf) arr.insertElement(0, csrf)
    if (!hasBodyGuard) arr.addElement('passwordSignInMiddleware')
  }
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
