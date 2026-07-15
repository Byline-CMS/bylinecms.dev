import {
  type Expression,
  type Identifier,
  Node,
  Project,
  ScriptTarget,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
  VariableDeclarationKind,
} from 'ts-morph'

export type StaticValue = string | number | boolean | null | StaticValue[] | StaticObject

export interface StaticObject {
  [key: string]: StaticValue
}

export type StaticResult<T> = { ok: true; value: T } | { ok: false; error: string }

interface EvaluationState {
  evaluating: Set<VariableDeclaration>
  bindings: Set<VariableDeclaration>
}

type BindingSymbol = NonNullable<ReturnType<VariableDeclaration['getSymbol']>>

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { target: ScriptTarget.ES2024 },
})

/** Parse one exported const without loading, transpiling, or executing its source. */
export function evaluateExportedConst(
  source: string,
  exportName: string
): StaticResult<StaticValue> {
  const sourceFile = project.createSourceFile(
    `static-config-${Math.random().toString(36).slice(2)}.ts`,
    source,
    { overwrite: true }
  )
  try {
    const diagnostics = project.getProgram().getSyntacticDiagnostics(sourceFile)
    if (diagnostics.length > 0) return failure('source contains parse diagnostics')
    const declaration = findExportedConst(sourceFile, exportName)
    if (!declaration) return failure(`exported const ${exportName} was not found`)
    const initializer = declaration.getInitializer()
    if (!initializer) return failure(`exported const ${exportName} has no initializer`)
    const state: EvaluationState = { evaluating: new Set(), bindings: new Set([declaration]) }
    const result = evaluate(initializer, sourceFile, state)
    return result.ok && hasUnsafeBindingEffects(sourceFile, state.bindings)
      ? failure('evaluated bindings are mutated or passed to effectful code')
      : result
  } finally {
    project.removeSourceFile(sourceFile)
  }
}

/** Evaluate only named properties; unrelated property initializers are never visited. */
export function evaluateExportedObjectProperties(
  source: string,
  exportName: string,
  propertyNames: readonly string[]
): StaticResult<StaticObject> {
  return withExportedInitializer(source, exportName, (initializer, sourceFile, state) =>
    evaluateObjectProperties(initializer, sourceFile, state, new Set(propertyNames))
  )
}

/** Evaluate named properties from each object in an exported array. */
export function evaluateExportedArrayObjectProperties(
  source: string,
  exportName: string,
  propertyNames: readonly string[]
): StaticResult<StaticObject[]> {
  return withExportedInitializer(source, exportName, (initializer, sourceFile, state) => {
    const array = evaluateArrayExpressions(initializer, sourceFile, state)
    if (!array.ok) return array
    const names = new Set(propertyNames)
    const values: StaticObject[] = []
    for (const expression of array.value) {
      const value = evaluateObjectProperties(expression, sourceFile, state, names)
      if (!value.ok) return value
      values.push(value.value)
    }
    return success(values)
  })
}

export function hasExportedCoreResolveRoutesCall(source: string, exportName: string): boolean {
  const sourceFile = project.createSourceFile(
    `static-config-${Math.random().toString(36).slice(2)}.ts`,
    source,
    { overwrite: true }
  )
  try {
    if (project.getProgram().getSyntacticDiagnostics(sourceFile).length > 0) return false
    const initializer = findExportedConst(sourceFile, exportName)?.getInitializer()
    if (!initializer) return false
    const expression = unwrap(initializer)
    if (!Node.isCallExpression(expression)) return false
    const callee = expression.getExpression()
    return (
      Node.isIdentifier(callee) &&
      expression.getArguments().length === 1 &&
      isCoreResolveRoutesImport(callee)
    )
  } finally {
    project.removeSourceFile(sourceFile)
  }
}

function withExportedInitializer<T>(
  source: string,
  exportName: string,
  evaluateInitializer: (
    initializer: Expression,
    sourceFile: SourceFile,
    state: EvaluationState
  ) => StaticResult<T>
): StaticResult<T> {
  const sourceFile = project.createSourceFile(
    `static-config-${Math.random().toString(36).slice(2)}.ts`,
    source,
    { overwrite: true }
  )
  try {
    const diagnostics = project.getProgram().getSyntacticDiagnostics(sourceFile)
    if (diagnostics.length > 0) return failure('source contains parse diagnostics')
    const declaration = findExportedConst(sourceFile, exportName)
    if (!declaration) return failure(`exported const ${exportName} was not found`)
    const initializer = declaration.getInitializer()
    if (!initializer) return failure(`exported const ${exportName} has no initializer`)
    const state: EvaluationState = { evaluating: new Set(), bindings: new Set([declaration]) }
    const result = evaluateInitializer(initializer, sourceFile, state)
    return result.ok && hasUnsafeBindingEffects(sourceFile, state.bindings)
      ? failure('evaluated bindings are mutated or passed to effectful code')
      : result
  } finally {
    project.removeSourceFile(sourceFile)
  }
}

function evaluate(
  expression: Expression,
  sourceFile: SourceFile,
  state: EvaluationState
): StaticResult<StaticValue> {
  const unwrapped = unwrap(expression)

  if (Node.isStringLiteral(unwrapped) || Node.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return success(unwrapped.getLiteralValue())
  }
  if (Node.isNumericLiteral(unwrapped)) return success(unwrapped.getLiteralValue())
  if (unwrapped.isKind(SyntaxKind.TrueKeyword)) return success(true)
  if (unwrapped.isKind(SyntaxKind.FalseKeyword)) return success(false)
  if (unwrapped.isKind(SyntaxKind.NullKeyword)) return success(null)

  if (Node.isArrayLiteralExpression(unwrapped)) {
    const values: StaticValue[] = []
    for (const element of unwrapped.getElements()) {
      if (Node.isOmittedExpression(element)) return failure('array holes are not static config')
      if (Node.isSpreadElement(element)) {
        const spread = evaluate(element.getExpression(), sourceFile, state)
        if (!spread.ok) return spread
        if (!Array.isArray(spread.value)) return failure('array spread must resolve to an array')
        values.push(...spread.value)
        continue
      }
      const value = evaluate(element, sourceFile, state)
      if (!value.ok) return value
      values.push(value.value)
    }
    return success(values)
  }

  if (Node.isObjectLiteralExpression(unwrapped)) {
    const value: StaticObject = Object.create(null) as StaticObject
    for (const property of unwrapped.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        const spread = evaluate(property.getExpression(), sourceFile, state)
        if (!spread.ok) return spread
        if (!isStaticObject(spread.value)) return failure('object spread must resolve to an object')
        Object.assign(value, spread.value)
        continue
      }
      if (Node.isPropertyAssignment(property)) {
        const name = staticPropertyName(property.getNameNode())
        if (name === null) return failure('computed property names are not static config')
        const propertyValue = evaluate(property.getInitializerOrThrow(), sourceFile, state)
        if (!propertyValue.ok) return propertyValue
        value[name] = propertyValue.value
        continue
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        const propertyValue = evaluate(property.getNameNode(), sourceFile, state)
        if (!propertyValue.ok) return propertyValue
        value[property.getName()] = propertyValue.value
        continue
      }
      return failure('methods and accessors are not static config')
    }
    return success(value)
  }

  if (Node.isIdentifier(unwrapped)) {
    const declaration = findTopLevelConst(sourceFile, unwrapped.getText())
    if (!declaration) return failure(`${unwrapped.getText()} is not a same-file immutable constant`)
    if (state.evaluating.has(declaration)) return failure('cyclic constants are not static config')
    const initializer = declaration.getInitializer()
    if (!initializer) return failure(`${unwrapped.getText()} has no initializer`)
    state.bindings.add(declaration)
    state.evaluating.add(declaration)
    const value = evaluate(initializer, sourceFile, state)
    state.evaluating.delete(declaration)
    return value
  }

  if (Node.isCallExpression(unwrapped)) {
    const callee = unwrapped.getExpression()
    const args = unwrapped.getArguments()
    if (!Node.isIdentifier(callee) || !isCoreResolveRoutesImport(callee)) {
      return failure('calls are not static config')
    }
    if (args.length !== 1 || !args[0] || !Node.isExpression(args[0])) {
      return failure('resolveRoutes must have one static object argument')
    }
    const routes = evaluate(args[0], sourceFile, state)
    if (!routes.ok) return routes
    if (!isStaticObject(routes.value)) return failure('resolveRoutes argument must be an object')
    return success({ admin: '/admin', api: '/api', signIn: '/sign-in', ...routes.value })
  }

  return failure(`${unwrapped.getKindName()} is not static config`)
}

function evaluateObjectProperties(
  expression: Expression,
  sourceFile: SourceFile,
  state: EvaluationState,
  propertyNames: ReadonlySet<string>
): StaticResult<StaticObject> {
  const unwrapped = unwrap(expression)
  if (Node.isIdentifier(unwrapped)) {
    const declaration = findTopLevelConst(sourceFile, unwrapped.getText())
    if (!declaration) return failure(`${unwrapped.getText()} is not a same-file immutable constant`)
    if (state.evaluating.has(declaration)) return failure('cyclic constants are not static config')
    const initializer = declaration.getInitializer()
    if (!initializer) return failure(`${unwrapped.getText()} has no initializer`)
    state.bindings.add(declaration)
    state.evaluating.add(declaration)
    const value = evaluateObjectProperties(initializer, sourceFile, state, propertyNames)
    state.evaluating.delete(declaration)
    return value
  }
  if (Node.isCallExpression(unwrapped)) {
    const callee = unwrapped.getExpression()
    const args = unwrapped.getArguments()
    if (!Node.isIdentifier(callee) || !isCoreResolveRoutesImport(callee)) {
      return failure('calls are not static config')
    }
    if (args.length !== 1 || !args[0] || !Node.isExpression(args[0])) {
      return failure('resolveRoutes must have one static object argument')
    }
    const value = evaluateObjectProperties(args[0], sourceFile, state, propertyNames)
    if (!value.ok) return value
    const defaults: StaticObject = { admin: '/admin', api: '/api', signIn: '/sign-in' }
    return success(
      Object.fromEntries(
        [...propertyNames].flatMap((name) => {
          const propertyValue = value.value[name] ?? defaults[name]
          return propertyValue === undefined ? [] : [[name, propertyValue]]
        })
      ) as StaticObject
    )
  }
  if (!Node.isObjectLiteralExpression(unwrapped)) {
    return failure(`${unwrapped.getKindName()} is not a static object`)
  }

  const value: StaticObject = Object.create(null) as StaticObject
  for (const property of unwrapped.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = evaluateObjectProperties(
        property.getExpression(),
        sourceFile,
        state,
        propertyNames
      )
      if (!spread.ok) return spread
      Object.assign(value, spread.value)
      continue
    }
    if (Node.isPropertyAssignment(property)) {
      const name = staticPropertyName(property.getNameNode())
      if (name === null) return failure('computed property names are not static config')
      if (!propertyNames.has(name)) continue
      const propertyValue = evaluate(property.getInitializerOrThrow(), sourceFile, state)
      if (!propertyValue.ok) return propertyValue
      value[name] = propertyValue.value
      continue
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      if (!propertyNames.has(property.getName())) continue
      const propertyValue = evaluate(property.getNameNode(), sourceFile, state)
      if (!propertyValue.ok) return propertyValue
      value[property.getName()] = propertyValue.value
      continue
    }
    const name = staticPropertyName(property.getNameNode())
    if (name === null || propertyNames.has(name)) {
      return failure('computed properties, methods, and accessors are not static config')
    }
  }
  return success(value)
}

function evaluateArrayExpressions(
  expression: Expression,
  sourceFile: SourceFile,
  state: EvaluationState
): StaticResult<Expression[]> {
  const unwrapped = unwrap(expression)
  if (Node.isIdentifier(unwrapped)) {
    const declaration = findTopLevelConst(sourceFile, unwrapped.getText())
    if (!declaration) return failure(`${unwrapped.getText()} is not a same-file immutable constant`)
    if (state.evaluating.has(declaration)) return failure('cyclic constants are not static config')
    const initializer = declaration.getInitializer()
    if (!initializer) return failure(`${unwrapped.getText()} has no initializer`)
    state.bindings.add(declaration)
    state.evaluating.add(declaration)
    const value = evaluateArrayExpressions(initializer, sourceFile, state)
    state.evaluating.delete(declaration)
    return value
  }
  if (!Node.isArrayLiteralExpression(unwrapped)) {
    return failure(`${unwrapped.getKindName()} is not a static array`)
  }
  const values: Expression[] = []
  for (const element of unwrapped.getElements()) {
    if (Node.isOmittedExpression(element)) return failure('array holes are not static config')
    if (Node.isSpreadElement(element)) {
      const spread = evaluateArrayExpressions(element.getExpression(), sourceFile, state)
      if (!spread.ok) return spread
      values.push(...spread.value)
    } else {
      values.push(element)
    }
  }
  return success(values)
}

function hasUnsafeBindingEffects(
  sourceFile: SourceFile,
  initialBindings: ReadonlySet<VariableDeclaration>
): boolean {
  const symbols = new Set<BindingSymbol>()
  for (const declaration of initialBindings) {
    const symbol = declaration.getSymbol()
    if (symbol) symbols.add(symbol)
  }
  const aliasAssignments = new Set<Node>()
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer()
      if (!initializer || !referencesSymbols(initializer, symbols)) continue
      changed = addBindingSymbols(declaration, symbols) || changed
    }
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue
      if (!referencesSymbols(assignment.getRight(), symbols)) continue
      const left = assignment.getLeft()
      if (!Node.isIdentifier(left)) continue
      const symbol = left.getSymbol()
      if (!symbol || symbols.has(symbol)) continue
      symbols.add(symbol)
      aliasAssignments.add(assignment)
      changed = true
    }
  }

  return sourceFile.getDescendants().some((node) => {
    if (Node.isBinaryExpression(node) && isAssignmentOperator(node.getOperatorToken().getKind())) {
      if (aliasAssignments.has(node)) return false
      return (
        referencesSymbols(node.getLeft(), symbols) || referencesSymbols(node.getRight(), symbols)
      )
    }
    if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
      const operator = node.getOperatorToken()
      return (
        (operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) &&
        referencesSymbols(node.getOperand(), symbols)
      )
    }
    if (Node.isDeleteExpression(node)) return referencesSymbols(node.getExpression(), symbols)
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression()
      if (Node.isIdentifier(callee) && isCoreResolveRoutesImport(callee)) {
        return false
      }
      return (
        referencesSymbols(callee, symbols) ||
        node.getArguments().some((argument) => referencesSymbols(argument, symbols))
      )
    }
    if (Node.isNewExpression(node)) {
      return node.getArguments().some((argument) => referencesSymbols(argument, symbols))
    }
    if (Node.isForInStatement(node) || Node.isForOfStatement(node)) {
      const initializer = node.getInitializer()
      return Node.isExpression(initializer) && referencesSymbols(initializer, symbols)
    }
    return false
  })
}

function addBindingSymbols(declaration: VariableDeclaration, symbols: Set<BindingSymbol>): boolean {
  const name = declaration.getNameNode()
  const identifiers = Node.isIdentifier(name)
    ? [name]
    : name.getDescendantsOfKind(SyntaxKind.Identifier)
  let changed = false
  for (const identifier of identifiers) {
    const symbol = identifier.getSymbol()
    if (!symbol || symbols.has(symbol)) continue
    symbols.add(symbol)
    changed = true
  }
  return changed
}

function referencesSymbols(node: Node, symbols: ReadonlySet<BindingSymbol>): boolean {
  const identifiers = Node.isIdentifier(node)
    ? [node, ...node.getDescendantsOfKind(SyntaxKind.Identifier)]
    : node.getDescendantsOfKind(SyntaxKind.Identifier)
  return identifiers.some((identifier) => {
    const symbol = identifier.getSymbol()
    return symbol !== undefined && symbols.has(symbol)
  })
}

function isAssignmentOperator(kind: SyntaxKind): boolean {
  return kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment
}

function unwrap(expression: Expression): Expression {
  let current = expression
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression()
  }
  return current
}

function findExportedConst(sourceFile: SourceFile, name: string): VariableDeclaration | undefined {
  const declaration = findTopLevelConst(sourceFile, name)
  const statement = declaration?.getVariableStatement()
  return statement?.isExported() ? declaration : undefined
}

function findTopLevelConst(sourceFile: SourceFile, name: string): VariableDeclaration | undefined {
  return sourceFile.getVariableDeclarations().find((declaration) => {
    const statement = declaration.getVariableStatement()
    return (
      declaration.getName() === name &&
      statement?.getParent() === sourceFile &&
      statement.getDeclarationKind() === VariableDeclarationKind.Const
    )
  })
}

function staticPropertyName(name: Node): string | null {
  if (Node.isIdentifier(name) || Node.isStringLiteral(name) || Node.isNumericLiteral(name)) {
    return Node.isIdentifier(name) ? name.getText() : String(name.getLiteralValue())
  }
  return null
}

function isCoreResolveRoutesImport(identifier: Identifier): boolean {
  const declarations = identifier.getSymbol()?.getDeclarations() ?? []
  if (declarations.length !== 1) return false
  const [declaration] = declarations
  if (!declaration || !Node.isImportSpecifier(declaration) || declaration.isTypeOnly()) return false
  const importDeclaration = declaration.getImportDeclaration()
  return (
    !importDeclaration.isTypeOnly() &&
    importDeclaration.getModuleSpecifierValue() === '@byline/core' &&
    declaration.getName() === 'resolveRoutes'
  )
}

export function isStaticObject(value: StaticValue): value is StaticObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function success<T>(value: T): StaticResult<T> {
  return { ok: true, value }
}

function failure(error: string): StaticResult<never> {
  return { ok: false, error }
}
