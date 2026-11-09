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

import { createHash } from 'node:crypto'

import {
  type ArrayLiteralExpression,
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  Project,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'

import { KNOWN_MANAGED_VALUES, type ManagedKey } from './vite-config-known-values.js'

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
const CANONICAL_NITRO_KEYS = ['noExternals', 'rolldownConfig', 'features'] as const

/** Where `bylineNitroFeatures`, the canonical `features` value, is imported from. */
const NITRO_FEATURES_MODULE = '@byline/host-tanstack-start/vite'
const NITRO_FEATURES_HELPER = 'bylineNitroFeatures'

/** The plugin Byline prepends to the `plugins` array. */
const BYLINE_PLUGIN_CALL = 'browserAsyncHooksAlias()'

/**
 * A substring that only appears in Byline's own value for a given key.
 *
 * A marker says a value *contains* Byline configuration. It does not make the
 * whole value Byline's: a host may add an external, or another Nitro option,
 * next to Byline's. So a marker never licenses a replacement on its own — it
 * only decides how a value that cannot be replaced is described: as a
 * customized copy of Byline's value, or as the host's own setting.
 */
const KEY_MARKERS: Record<string, string> = {
  environments: 'bylineSsrNoExternal',
  ssr: 'bylineSsrNoExternal',
  optimizeDeps: 'ssrExternal',
  noExternals: '@byline/',
  rolldownConfig: '@byline/',
  features: NITRO_FEATURES_HELPER,
}

/**
 * A structural fingerprint of a value: its syntax tree with comments,
 * whitespace, quote style and trailing commas removed. Two values with the same
 * fingerprint are the same configuration however they are formatted, so a
 * config reformatted by the host's own formatter is never reported as changed.
 */
function fingerprintValue(node: Node): string {
  return createHash('sha256').update(structure(node)).digest('hex').slice(0, 16)
}

function structure(node: Node): string {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return JSON.stringify(node.getLiteralValue())
  }
  if (Node.isArrayLiteralExpression(node)) {
    return `[${node.getElements().map(structure).join(',')}]`
  }
  if (Node.isObjectLiteralExpression(node)) {
    return `{${node.getProperties().map(structure).join(',')}}`
  }
  const children = node.getChildren()
  if (children.length === 0) return node.getText()
  return children
    .filter((child) => child.getKind() !== SyntaxKind.CommaToken || child.getNextSibling())
    .map(structure)
    .join(' ')
}

/** What a host config holds under one of the keys Byline manages. */
type ManagedValueState =
  /** Not set: Byline adds its value. */
  | 'missing'
  /** Byline's current value, in any formatting. */
  | 'current'
  /** A value an earlier Byline release wrote verbatim: safe to replace. */
  | 'known'
  /** Byline's value with host changes: left untouched and reported. */
  | 'customized'
  /** The host's own value: left untouched and reported. */
  | 'host'

function classifyManagedValue(
  key: ManagedKey,
  property: Node | undefined,
  canonicalFingerprint: string | undefined
): ManagedValueState {
  if (!property) return 'missing'
  const initializer = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined
  const text = property.getText()
  const marker = KEY_MARKERS[baseKey(key)]
  const marked = marker != null && text.includes(marker)
  if (!initializer) return marked ? 'customized' : 'host'
  // Passing the host's own features through the helper is the documented use,
  // not a customization of Byline's value.
  if (
    key === 'nitro.features' &&
    Node.isCallExpression(initializer) &&
    initializer.getExpression().getText() === NITRO_FEATURES_HELPER
  ) {
    return 'current'
  }
  const fingerprint = fingerprintValue(initializer)
  if (fingerprint === canonicalFingerprint) return 'current'
  if (KNOWN_MANAGED_VALUES[key].includes(fingerprint)) return 'known'
  return marked ? 'customized' : 'host'
}

function baseKey(key: ManagedKey): string {
  return key.startsWith('nitro.') ? key.slice('nitro.'.length) : key
}

function managedLabel(key: ManagedKey): string {
  return key.startsWith('nitro.') ? `nitro \`${baseKey(key)}\`` : `\`${key}\``
}

function customizedNote(key: ManagedKey): string {
  return `${managedLabel(key)} differs from every value Byline has shipped; merge Byline's current value into it by hand`
}

function hostOwnedNote(key: ManagedKey): string {
  if (key === 'nitro.features') {
    return `nitro \`features\` is already set; pass your features through \`${NITRO_FEATURES_HELPER}({ ... })\` from ${NITRO_FEATURES_MODULE} so Byline can turn off srvx FastResponse (h3js/srvx#343)`
  }
  return `${managedLabel(key)} is already set`
}

/**
 * The fingerprint of each managed value in a config, keyed like
 * {@link KNOWN_MANAGED_VALUES}. Keys the config does not set are absent. Used
 * to pin the canonical values, so that changing one forces its previous
 * fingerprint into the known list.
 */
export function managedValueFingerprints(configSource: string): Map<ManagedKey, string> {
  const fingerprints = new Map<ManagedKey, string>()
  const source = newProject().createSourceFile('vite.config.ts', configSource)
  const configObject = findDefineConfigObject(source)
  if (!configObject) return fingerprints
  const record = (key: ManagedKey, property: Node | undefined) => {
    const initializer =
      property && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined
    if (initializer) fingerprints.set(key, fingerprintValue(initializer))
  }
  for (const key of CANONICAL_CONFIG_KEYS) record(key, configObject.getProperty(key))
  const nitroCall = findNitroCall(configObject)
  const nitroObject = nitroCall ? firstObjectArgument(nitroCall) : undefined
  if (nitroObject) {
    for (const key of CANONICAL_NITRO_KEYS) record(`nitro.${key}`, nitroObject.getProperty(key))
  }
  return fingerprints
}

export interface CanonicalPieces {
  /** Source text of each module-level statement, keyed by declaration name. */
  statements: Map<string, string>
  /** Source text of each `defineConfig` property, keyed by property name. */
  configProps: Map<string, string>
  /** Source text of each `nitro()` option, keyed by property name. */
  nitroProps: Map<string, string>
  /** Source text of each managed value, without its key, for in-place updates. */
  values: Map<ManagedKey, string>
  /** Structural fingerprint of each managed value. */
  fingerprints: Map<ManagedKey, string>
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
  /** Nothing to apply, but some managed values were customized by the host. */
  | { kind: 'customized'; notes: string[] }
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

  const values = new Map<ManagedKey, string>()
  const fingerprints = new Map<ManagedKey, string>()
  const recordValue = (key: ManagedKey, property: Node) => {
    const initializer = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined
    if (!initializer)
      throw new Error(`canonical vite.config.ts sets ${managedLabel(key)} without a value`)
    values.set(key, initializer.getText())
    fingerprints.set(key, fingerprintValue(initializer))
  }

  const configProps = new Map<string, string>()
  for (const key of CANONICAL_CONFIG_KEYS) {
    const property = configObject.getProperty(key)
    if (!property) throw new Error(`canonical vite.config.ts no longer sets \`${key}\``)
    configProps.set(key, property.getText())
    recordValue(key, property)
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
    recordValue(`nitro.${key}`, property)
  }

  return { statements, configProps, nitroProps, values, fingerprints }
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
  const customized: string[] = []

  const missingStatements = CANONICAL_STATEMENTS.filter((name) => !declaresName(source, name))

  // Byline replaces a value only when it is provably one Byline wrote: its
  // current value, or a value an earlier release shipped verbatim. Anything
  // else — the host's own setting, or Byline's value with host additions — is
  // left untouched and reported, because replacing it would silently drop
  // settings the host's build may need.
  const sort = (
    key: ManagedKey,
    property: Node | undefined,
    toAdd: string[],
    toReplace: string[]
  ) => {
    switch (classifyManagedValue(key, property, canonical.fingerprints.get(key))) {
      case 'missing':
        toAdd.push(baseKey(key))
        break
      case 'known':
        toReplace.push(baseKey(key))
        break
      case 'customized':
        customized.push(customizedNote(key))
        break
      case 'host':
        unplaced.push(hostOwnedNote(key))
        break
      case 'current':
        break
    }
  }

  const configKeysToAdd: string[] = []
  const configKeysToReplace: string[] = []
  for (const key of CANONICAL_CONFIG_KEYS) {
    sort(key, configObject.getProperty(key), configKeysToAdd, configKeysToReplace)
  }

  const pluginsArray = getPluginsArray(configObject)
  const nitroCall = pluginsArray ? findNitroCallInArray(pluginsArray) : undefined
  const nitroObject = nitroCall ? firstObjectArgument(nitroCall) : undefined

  const nitroKeysToAdd: string[] = []
  const nitroKeysToReplace: string[] = []
  if (!pluginsArray) {
    unplaced.push('no inline `plugins: [ ... ]` array to register Byline plugins in')
  } else if (!nitroCall) {
    unplaced.push('no `nitro( ... )` plugin call found')
  } else if (!nitroObject) {
    unplaced.push('`nitro( ... )` is not called with an inline object literal')
  } else {
    for (const key of CANONICAL_NITRO_KEYS) {
      sort(`nitro.${key}`, nitroObject.getProperty(key), nitroKeysToAdd, nitroKeysToReplace)
    }
  }

  const addsPlugin = pluginsArray != null && !pluginsArrayHasByline(pluginsArray)

  if (missingStatements.length > 0) changes.push(`add ${missingStatements.join(', ')}`)
  if (configKeysToAdd.length > 0) changes.push(`set ${configKeysToAdd.join(', ')}`)
  if (configKeysToReplace.length > 0) changes.push(`update ${configKeysToReplace.join(', ')}`)
  if (nitroKeysToAdd.length > 0) changes.push(`set nitro ${nitroKeysToAdd.join(', ')}`)
  if (nitroKeysToReplace.length > 0) changes.push(`update nitro ${nitroKeysToReplace.join(', ')}`)
  if (addsPlugin) changes.push('register browserAsyncHooksAlias()')

  if (changes.length === 0 && unplaced.length === 0) {
    return customized.length === 0
      ? { kind: 'canonical' }
      : { kind: 'customized', notes: customized }
  }
  if (changes.length === 0) {
    return {
      kind: 'unrecognized',
      reason: `nothing could be applied automatically (${[...unplaced, ...customized].join('; ')})`,
    }
  }

  return {
    kind: 'mergeable',
    plan: {
      changes,
      unplaced: [...unplaced, ...customized],
      apply() {
        // Re-parse so the plan owns a clean tree; analysis must not mutate.
        const applyProject = newProject()
        const applySource = applyProject.createSourceFile('vite.config.ts', userSource)
        const applyConfig = findDefineConfigObject(applySource)
        if (!applyConfig) return userSource

        ensureNamedImport(applySource, 'node:url', 'fileURLToPath')
        ensureTypeOnlyNamedImport(applySource, 'vite', 'Plugin')

        insertStatementsBeforeConfig(applySource, canonical, missingStatements)

        // A known earlier value is updated in place — its initializer swapped,
        // the property and the commas around it kept — so the host's layout
        // and trailing-comma style survive.
        const replaceValue = (object: ObjectLiteralExpression, key: ManagedKey) => {
          const property = object.getProperty(baseKey(key))
          const value = canonical.values.get(key)
          if (property && value && Node.isPropertyAssignment(property)) {
            property.setInitializer(value)
          }
        }

        for (const key of configKeysToReplace) replaceValue(applyConfig, key as ManagedKey)
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
            for (const key of nitroKeysToReplace) {
              replaceValue(applyNitroObject, `nitro.${key}` as ManagedKey)
            }
            for (const key of nitroKeysToAdd) {
              const text = canonical.nitroProps.get(key)
              if (text) applyNitroObject.addProperty(text)
            }
          }
        }

        // Added after the property edits: inserting an import first would
        // invalidate the nitro object node those edits hold.
        if ([...nitroKeysToReplace, ...nitroKeysToAdd].includes('features')) {
          ensureNamedImport(applySource, NITRO_FEATURES_MODULE, NITRO_FEATURES_HELPER)
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
