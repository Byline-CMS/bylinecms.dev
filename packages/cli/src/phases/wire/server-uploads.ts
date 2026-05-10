import { existsSync, readFileSync } from 'node:fs'

import {
  type CallExpression,
  Node,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  Project,
  type SourceFile,
  SyntaxKind,
  type Node as TsMorphNode,
} from 'ts-morph'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'src/server.ts'
const SERVE_UPLOADS_NAME = 'serveUploads'
const SERVE_UPLOADS_MODULE = '@byline/host-tanstack-start/integrations/serve-uploads'

const SNIPPET = `import { ${SERVE_UPLOADS_NAME} } from '${SERVE_UPLOADS_MODULE}'

// Inside createServerEntry({ ... }), replace the fetch handler with:
async fetch(request) {
  const upload = await ${SERVE_UPLOADS_NAME}(request)
  if (upload) return upload
  return handler.fetch(request)
},
`

export const wireServerUploads: SubEdit = {
  key: 'server-uploads',
  title: `Wrap fetch with \`${SERVE_UPLOADS_NAME}\` runtime handler in ${REL}`,
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

  // Cheap pre-check: if the helper is already referenced anywhere, we
  // assume it's wired. Avoids a full AST round-trip on the common
  // already-wired case and on any non-trivial server.ts the user has
  // hand-customized to call serveUploads themselves.
  const text = readFileSync(path, 'utf8')
  if (text.includes(SERVE_UPLOADS_NAME)) {
    return { status: 'skipped', message: `${REL}: ${SERVE_UPLOADS_NAME} already wired` }
  }

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  let source: SourceFile
  try {
    source = project.addSourceFileAtPath(path)
  } catch {
    return manualBail(`${REL}: could not parse`)
  }

  const createServerEntryCall = findCreateServerEntryCall(source)
  if (!createServerEntryCall) {
    return manualBail(`${REL}: no \`createServerEntry(...)\` call found`)
  }

  const optionsLiteral = getFirstObjectArg(createServerEntryCall)
  if (!optionsLiteral) {
    return manualBail(
      `${REL}: \`createServerEntry\` argument is not an inline object literal — cannot safely auto-edit`
    )
  }

  const fetchProp = optionsLiteral.getProperty('fetch')
  if (!fetchProp) {
    return manualBail(`${REL}: no \`fetch\` property on \`createServerEntry\` options`)
  }

  if (!isCanonicalFetchProperty(fetchProp)) {
    return manualBail(
      `${REL}: existing \`fetch\` does not match the canonical scaffold (\`fetch(request) { return handler.fetch(request) }\`) — manual wire required`
    )
  }

  if (dryRun) {
    return {
      status: 'done',
      message: `${REL}: will wrap fetch with ${SERVE_UPLOADS_NAME}`,
    }
  }

  ensureImport(source)
  replaceFetchMethod(optionsLiteral)
  source.saveSync()

  return { status: 'done', message: `${REL}: wrapped fetch with ${SERVE_UPLOADS_NAME}` }
}

function manualBail(message: string): SubEditResult {
  return { status: 'manual', message, snippet: SNIPPET }
}

function findCreateServerEntryCall(source: SourceFile): CallExpression | undefined {
  // Walk top-level descendants looking for any `createServerEntry(...)`
  // call. The TanStack Start scaffold exports it via `export default`,
  // but we accept any position in the file.
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === 'createServerEntry') return call
  }
  return undefined
}

function getFirstObjectArg(call: CallExpression): ObjectLiteralExpression | undefined {
  const args = call.getArguments()
  if (args.length === 0) return undefined
  const first = args[0]
  if (first && Node.isObjectLiteralExpression(first)) return first
  return undefined
}

/**
 * Recognise the canonical TanStack Start scaffold shape so we only edit
 * a `fetch` we fully understand. Three accepted forms (all equivalent
 * in behaviour):
 *
 *   fetch(request) { return handler.fetch(request) }    // method shorthand
 *   fetch: (request) => handler.fetch(request)          // arrow w/ expr body
 *   fetch: (request) => { return handler.fetch(request) }
 *   fetch: function (request) { return handler.fetch(request) }
 *
 * Anything else — extra statements, async, type annotations on the
 * parameter, a different parameter name, a wrapped/intercepted call —
 * forces a manual bail.
 */
function isCanonicalFetchProperty(prop: ObjectLiteralElementLike): boolean {
  const shape = extractFunctionShape(prop)
  if (!shape) return false
  const { parameters, body } = shape

  if (parameters.length !== 1) return false
  if (parameters[0]?.getName() !== 'request') return false
  if (!body) return false

  // Body should evaluate `handler.fetch(request)` — either as the sole
  // statement of a block (`{ return handler.fetch(request) }`) or as
  // the bare expression of an arrow function.
  let returnExpr: TsMorphNode | undefined
  if (Node.isBlock(body)) {
    const stmts = body.getStatements()
    if (stmts.length !== 1) return false
    const only = stmts[0]
    if (!only || !Node.isReturnStatement(only)) return false
    returnExpr = only.getExpression()
  } else {
    returnExpr = body
  }

  if (!returnExpr || !Node.isCallExpression(returnExpr)) return false

  // Callee text, whitespace-stripped, must be exactly `handler.fetch`.
  const callee = returnExpr.getExpression().getText().replace(/\s+/g, '')
  if (callee !== 'handler.fetch') return false

  const callArgs = returnExpr.getArguments()
  if (callArgs.length !== 1) return false
  if (callArgs[0]?.getText() !== 'request') return false

  return true
}

interface FunctionShape {
  parameters: ParameterDeclaration[]
  body: TsMorphNode | undefined
}

function extractFunctionShape(prop: ObjectLiteralElementLike): FunctionShape | undefined {
  if (Node.isMethodDeclaration(prop)) {
    return { parameters: prop.getParameters(), body: prop.getBody() }
  }
  if (Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer()
    if (!init) return undefined
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      return { parameters: init.getParameters(), body: init.getBody() }
    }
  }
  return undefined
}

function ensureImport(source: SourceFile): void {
  const existing = source
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === SERVE_UPLOADS_MODULE)
  if (existing) {
    const already = existing.getNamedImports().some((n) => n.getName() === SERVE_UPLOADS_NAME)
    if (!already) existing.addNamedImport(SERVE_UPLOADS_NAME)
    return
  }
  // Insert after the last existing import; placement among siblings
  // doesn't matter for behaviour.
  const imports = source.getImportDeclarations()
  source.insertImportDeclaration(imports.length, {
    moduleSpecifier: SERVE_UPLOADS_MODULE,
    namedImports: [SERVE_UPLOADS_NAME],
  })
}

function replaceFetchMethod(options: ObjectLiteralExpression): void {
  const existing = options.getProperty('fetch')
  if (existing) existing.remove()

  options.addMethod({
    name: 'fetch',
    isAsync: true,
    parameters: [{ name: 'request' }],
    statements: [
      `const upload = await ${SERVE_UPLOADS_NAME}(request)`,
      'if (upload) return upload',
      'return handler.fetch(request)',
    ],
  })
}
