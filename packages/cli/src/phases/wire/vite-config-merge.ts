/**
 * Merge Byline's required Vite settings into a host application's own
 * `vite.config.ts`.
 *
 * The settings themselves are never written out by hand here. They are
 * extracted from the canonical template (`templates/host/vite.config.ts`) at
 * runtime, so that file stays the single source of truth and this module
 * cannot drift from it. `extractCanonicalPieces` is pinned by a contract test.
 *
 * Merging is deliberately conservative: every insertion must land in a key the
 * host config does not already define. If the config declares any of the keys
 * Byline owns, or is shaped in a way this module does not recognise, the caller
 * is told which pieces could not be placed and falls back to asking the user to
 * merge them by hand. A wrong merge is worse than no merge — it moves the
 * failure from install time, where the CLI can explain it, to a confusing
 * runtime or production-build failure.
 */

import {
  type ArrayLiteralExpression,
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'

/** Statements Byline adds above `defineConfig`, in declaration order. */
const CANONICAL_STATEMENTS = [
  'browserAsyncHooksShim',
  'browserAsyncHooksAlias',
  'bylineSsrNoExternal',
  'ssrExternal',
] as const

/** Top-level `defineConfig({...})` keys Byline owns. */
const CANONICAL_CONFIG_KEYS = ['environments', 'ssr', 'optimizeDeps'] as const

/** Keys Byline adds to the `nitro({...})` plugin call. */
const CANONICAL_NITRO_KEYS = ['noExternals', 'rolldownConfig'] as const

/** The plugin Byline prepends to the `plugins` array. */
const BYLINE_PLUGIN_CALL = 'browserAsyncHooksAlias()'

/**
 * A substring that only appears in Byline's own value for a given key.
 *
 * A key being present is not the same as a key being *ours*. Re-running `init`,
 * or inspecting the canonical config itself, must recognise Byline's settings as
 * already applied rather than reporting them as host-owned conflicts. Byline's
 * values always reference a Byline identifier or scope, so that is the tell.
 */
const KEY_MARKERS: Record<string, string> = {
  environments: 'bylineSsrNoExternal',
  ssr: 'bylineSsrNoExternal',
  optimizeDeps: 'ssrExternal',
  noExternals: '@byline/',
  rolldownConfig: '@byline/',
}

function isBylineOwnedValue(key: string, text: string): boolean {
  const marker = KEY_MARKERS[key]
  return marker != null && text.includes(marker)
}

export interface CanonicalPieces {
  /** Source text of each module-level statement, keyed by declaration name. */
  statements: Map<string, string>
  /** Source text of each `defineConfig` property, keyed by property name. */
  configProps: Map<string, string>
  /** Source text of each `nitro()` option, keyed by property name. */
  nitroProps: Map<string, string>
}

export interface MergePlan {
  /** Human-readable description of each edit, for the phase preview. */
  changes: string[]
  /** Pieces that could not be placed; the caller surfaces these for hand-merge. */
  unplaced: string[]
  /** Applies the plan and returns the edited source text. */
  apply(): string
}

export type MergeAnalysis =
  | { kind: 'canonical' }
  | { kind: 'mergeable'; plan: MergePlan }
  | { kind: 'unrecognized'; reason: string }

function newProject(): Project {
  return new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true })
}

/**
 * Pull the Byline-owned pieces out of the canonical template. Throws if the
 * template no longer contains an expected piece — that is a build-time bug in
 * Byline, not a problem with the user's config, and it must fail loudly.
 */
export function extractCanonicalPieces(canonicalSource: string): CanonicalPieces {
  const source = newProject().createSourceFile('canonical.ts', canonicalSource)

  const statements = new Map<string, string>()
  for (const name of CANONICAL_STATEMENTS) {
    const declaration = source.getVariableStatement((statement) =>
      statement.getDeclarations().some((d) => d.getName() === name)
    )
    if (!declaration) {
      throw new Error(`canonical vite.config.ts no longer declares \`${name}\``)
    }
    statements.set(name, declaration.getText())
  }

  const configObject = findDefineConfigObject(source)
  if (!configObject) {
    throw new Error('canonical vite.config.ts has no recognisable defineConfig({...}) call')
  }

  const configProps = new Map<string, string>()
  for (const key of CANONICAL_CONFIG_KEYS) {
    const property = configObject.getProperty(key)
    if (!property) throw new Error(`canonical vite.config.ts no longer sets \`${key}\``)
    configProps.set(key, property.getText())
  }

  const nitroCall = findNitroCall(configObject)
  const nitroObject = nitroCall ? firstObjectArgument(nitroCall) : undefined
  if (!nitroObject) {
    throw new Error('canonical vite.config.ts has no recognisable nitro({...}) call')
  }

  const nitroProps = new Map<string, string>()
  for (const key of CANONICAL_NITRO_KEYS) {
    const property = nitroObject.getProperty(key)
    if (!property) throw new Error(`canonical vite.config.ts no longer sets nitro \`${key}\``)
    nitroProps.set(key, property.getText())
  }

  return { statements, configProps, nitroProps }
}

/**
 * Decide whether the host's config can take Byline's settings, and if so return
 * a plan that applies them.
 *
 * The async-hooks alias references `byline/async-hooks.browser.ts`, which the
 * scaffold phase writes. Wire runs *before* scaffold, so that file does not
 * exist yet at this point — we still emit the reference, exactly as the
 * canonical full-replace path does, because scaffold always follows wire in a
 * normal `init`. Gating on the file's presence would silently drop the alias
 * from every fresh install.
 */
export function analyzeUserConfig(userSource: string, canonical: CanonicalPieces): MergeAnalysis {
  const project = newProject()
  let source: SourceFile
  try {
    source = project.createSourceFile('vite.config.ts', userSource)
  } catch {
    return { kind: 'unrecognized', reason: 'could not be parsed as TypeScript' }
  }
  // Only syntactic problems disqualify a config. This project loads no lib or
  // type information, so semantic diagnostics (codes >= 2000) are dominated by
  // "cannot find module 'vite'" and say nothing about whether the file parses.
  // TypeScript reserves codes below 2000 for the parser.
  if (source.getPreEmitDiagnostics().some((d) => d.getCode() < 2000)) {
    return { kind: 'unrecognized', reason: 'contains syntax errors' }
  }

  const configObject = findDefineConfigObject(source)
  if (!configObject) {
    return {
      kind: 'unrecognized',
      reason: 'no `defineConfig({ ... })` call with an inline object literal was found',
    }
  }

  const changes: string[] = []
  const unplaced: string[] = []

  const missingStatements = CANONICAL_STATEMENTS.filter((name) => !declaresName(source, name))

  // Byline only claims keys the host has not already set. A key holding a
  // host-authored value is reported rather than merged into — we cannot know
  // whether that value was deliberate. A key already holding Byline's own value
  // is simply done.
  const configKeysToAdd: string[] = []
  for (const key of CANONICAL_CONFIG_KEYS) {
    const property = configObject.getProperty(key)
    if (!property) {
      configKeysToAdd.push(key)
    } else if (!isBylineOwnedValue(key, property.getText())) {
      unplaced.push(`\`${key}\` is already set`)
    }
  }

  const pluginsArray = getPluginsArray(configObject)
  const nitroCall = pluginsArray ? findNitroCallInArray(pluginsArray) : undefined
  const nitroObject = nitroCall ? firstObjectArgument(nitroCall) : undefined

  const nitroKeysToAdd: string[] = []
  if (!pluginsArray) {
    unplaced.push('no inline `plugins: [ ... ]` array to register Byline plugins in')
  } else if (!nitroCall) {
    unplaced.push('no `nitro( ... )` plugin call found')
  } else if (!nitroObject) {
    unplaced.push('`nitro( ... )` is not called with an inline object literal')
  } else {
    for (const key of CANONICAL_NITRO_KEYS) {
      const property = nitroObject.getProperty(key)
      if (!property) {
        nitroKeysToAdd.push(key)
      } else if (!isBylineOwnedValue(key, property.getText())) {
        unplaced.push(`nitro \`${key}\` is already set`)
      }
    }
  }

  const addsPlugin = pluginsArray != null && !pluginsArrayHasByline(pluginsArray)

  if (missingStatements.length > 0) changes.push(`add ${missingStatements.join(', ')}`)
  if (configKeysToAdd.length > 0) changes.push(`set ${configKeysToAdd.join(', ')}`)
  if (nitroKeysToAdd.length > 0) changes.push(`set nitro ${nitroKeysToAdd.join(', ')}`)
  if (addsPlugin) changes.push('register browserAsyncHooksAlias()')

  if (changes.length === 0 && unplaced.length === 0) {
    return { kind: 'canonical' }
  }
  if (changes.length === 0) {
    return {
      kind: 'unrecognized',
      reason: `nothing could be applied automatically (${unplaced.join('; ')})`,
    }
  }

  return {
    kind: 'mergeable',
    plan: {
      changes,
      unplaced,
      apply() {
        // Re-parse so the plan owns a clean tree; analysis must not mutate.
        const applyProject = newProject()
        const applySource = applyProject.createSourceFile('vite.config.ts', userSource)
        const applyConfig = findDefineConfigObject(applySource)
        if (!applyConfig) return userSource

        ensureNamedImport(applySource, 'node:url', 'fileURLToPath')
        ensureTypeOnlyNamedImport(applySource, 'vite', 'Plugin')

        insertStatementsBeforeConfig(applySource, canonical, missingStatements)

        for (const key of configKeysToAdd) {
          const text = canonical.configProps.get(key)
          if (text) applyConfig.addProperty(text)
        }

        const applyPlugins = getPluginsArray(applyConfig)
        if (applyPlugins) {
          if (addsPlugin) applyPlugins.insertElement(0, BYLINE_PLUGIN_CALL)
          const applyNitro = findNitroCallInArray(applyPlugins)
          const applyNitroObject = applyNitro ? firstObjectArgument(applyNitro) : undefined
          if (applyNitroObject) {
            for (const key of nitroKeysToAdd) {
              const text = canonical.nitroProps.get(key)
              if (text) applyNitroObject.addProperty(text)
            }
          }
        }

        applySource.formatText({ indentSize: 2 })
        return applySource.getFullText()
      },
    },
  }
}

function declaresName(source: SourceFile, name: string): boolean {
  return source
    .getVariableStatements()
    .some((statement) => statement.getDeclarations().some((d) => d.getName() === name))
}

function insertStatementsBeforeConfig(
  source: SourceFile,
  canonical: CanonicalPieces,
  names: readonly string[]
): void {
  if (names.length === 0) return
  const anchor = source
    .getStatements()
    .find((statement) =>
      statement.getDescendantsOfKind(SyntaxKind.CallExpression).some(isDefineConfigCall)
    )
  const index = anchor ? anchor.getChildIndex() : source.getStatements().length
  const texts = names
    .map((name) => canonical.statements.get(name))
    .filter((text): text is string => text != null)
  source.insertStatements(index, texts)
}

function isDefineConfigCall(call: CallExpression): boolean {
  return call.getExpression().getText() === 'defineConfig'
}

function findDefineConfigObject(source: SourceFile): ObjectLiteralExpression | undefined {
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDefineConfigCall(call)) continue
    const object = firstObjectArgument(call)
    if (object) return object
  }
  return undefined
}

function firstObjectArgument(call: CallExpression): ObjectLiteralExpression | undefined {
  const [first] = call.getArguments()
  if (first && Node.isObjectLiteralExpression(first)) return first
  return undefined
}

function getPluginsArray(config: ObjectLiteralExpression): ArrayLiteralExpression | undefined {
  const property = config.getProperty('plugins')
  if (!property || !Node.isPropertyAssignment(property)) return undefined
  const initializer = property.getInitializer()
  if (initializer && Node.isArrayLiteralExpression(initializer)) return initializer
  return undefined
}

function findNitroCall(config: ObjectLiteralExpression): CallExpression | undefined {
  const plugins = getPluginsArray(config)
  return plugins ? findNitroCallInArray(plugins) : undefined
}

function findNitroCallInArray(plugins: ArrayLiteralExpression): CallExpression | undefined {
  for (const element of plugins.getElements()) {
    if (Node.isCallExpression(element) && element.getExpression().getText() === 'nitro') {
      return element
    }
  }
  return undefined
}

function pluginsArrayHasByline(plugins: ArrayLiteralExpression): boolean {
  return plugins
    .getElements()
    .some((element) => element.getText().includes('browserAsyncHooksAlias'))
}

function ensureNamedImport(source: SourceFile, moduleSpecifier: string, name: string): void {
  const existing = source
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === moduleSpecifier)
  if (existing) {
    if (!existing.getNamedImports().some((n) => n.getName() === name)) {
      existing.addNamedImport(name)
    }
    return
  }
  source.insertImportDeclaration(source.getImportDeclarations().length, {
    moduleSpecifier,
    namedImports: [name],
  })
}

function ensureTypeOnlyNamedImport(
  source: SourceFile,
  moduleSpecifier: string,
  name: string
): void {
  const existing = source
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === moduleSpecifier)
  if (existing) {
    if (!existing.getNamedImports().some((n) => n.getName() === name)) {
      existing.addNamedImport({ name, isTypeOnly: true })
    }
    return
  }
  source.insertImportDeclaration(source.getImportDeclarations().length, {
    moduleSpecifier,
    namedImports: [{ name, isTypeOnly: true }],
  })
}
