/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type AnyLexicalExtension,
  type AnyLexicalExtensionArgument,
  configExtension,
  type LexicalExtensionConfig,
} from 'lexical'

/**
 * Chainable wrapper around an ordered list of Lexical extensions. Used
 * inside the `lexicalEditor((c) => ...)` configure callback so site
 * authors can add, remove, configure, or reorder extensions before the
 * editor is built.
 *
 * Comparison is by extension `name` so a bare `LinkExtension` and a
 * `configExtension(LinkExtension, {...})` tuple are treated as the same
 * entry.
 */
export class ExtensionsList {
  private items: AnyLexicalExtensionArgument[]

  constructor(items: ReadonlyArray<AnyLexicalExtensionArgument> = []) {
    this.items = [...items]
  }

  /** Append `extension` to the end of the list. */
  add(extension: AnyLexicalExtensionArgument): this {
    this.items.push(extension)
    return this
  }

  /**
   * Remove every entry whose name matches the target. Accepts either an
   * extension object (matched by `.name`) or the name string directly —
   * the string form lets config-only code remove a built-in via
   * `builtInExtensions.*` without importing the heavy extension class.
   * No-op when the extension isn't present.
   */
  remove(extension: AnyLexicalExtension | string): this {
    const targetName = resolveTargetName(extension)
    this.items = this.items.filter((item) => extensionName(item) !== targetName)
    return this
  }

  /**
   * Replace `oldExtension` with `newExtension`, preserving position.
   * `oldExtension` may be an extension object or its name string; the
   * replacement must be a real extension argument.
   */
  replace(
    oldExtension: AnyLexicalExtension | string,
    newExtension: AnyLexicalExtensionArgument
  ): this {
    const targetName = resolveTargetName(oldExtension)
    let replaced = false
    this.items = this.items.map((item) => {
      if (!replaced && extensionName(item) === targetName) {
        replaced = true
        return newExtension
      }
      return item
    })
    if (!replaced) this.items.push(newExtension)
    return this
  }

  /**
   * Re-wrap an existing extension entry with a fresh `configExtension`
   * binding the supplied config. If the extension isn't present, it is
   * added. If it was already wrapped with `configExtension`, the wrapper
   * is replaced rather than nested.
   */
  configure<Extension extends AnyLexicalExtension>(
    extension: Extension,
    config: Partial<LexicalExtensionConfig<Extension>>
  ): this {
    const wrapped = configExtension(extension, config)
    return this.replace(extension, wrapped)
  }

  /**
   * True when an entry with the same `name` is present. Accepts an
   * extension object or its name string.
   */
  has(extension: AnyLexicalExtension | string): boolean {
    const targetName = resolveTargetName(extension)
    return this.items.some((item) => extensionName(item) === targetName)
  }

  /** Independent copy — safe to hand to a configure callback. */
  clone(): ExtensionsList {
    return new ExtensionsList(this.items)
  }

  /** The list as a plain array, ready for `defineExtension({ dependencies })`. */
  toArray(): AnyLexicalExtensionArgument[] {
    return [...this.items]
  }
}

/** Resolve a remove/has/replace target to its comparison name. */
function resolveTargetName(target: AnyLexicalExtension | string): string {
  return typeof target === 'string' ? target : target.name
}

function extensionName(item: AnyLexicalExtensionArgument): string | undefined {
  if (Array.isArray(item)) {
    const head = item[0]
    if (head != null && typeof head === 'object' && 'name' in head) {
      return (head as AnyLexicalExtension).name
    }
    return undefined
  }
  if (item != null && typeof item === 'object' && 'name' in item) {
    return (item as AnyLexicalExtension).name
  }
  return undefined
}
