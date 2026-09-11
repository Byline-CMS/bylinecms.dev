/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** What one richtext field accepts, as its resolved editor reports it. */
export interface FieldCapabilities {
  collectionPath: string
  /**
   * Declaration path of the field, so one nested in a block or array is
   * addressable — `content.photoBlock.caption`, not just `caption`.
   * Stored values carry instance paths (`content.1.photoBlock.caption`);
   * eliding the selectors yields this.
   */
  fieldPath: string
  /**
   * Node types the field accepts, or `null` when they could not be
   * measured.
   *
   * A field whose capabilities are unknown is NOT the same as a field
   * with none. The scanner reports it as unmapped rather than treating
   * its documents as clean, because reporting a document safe when it
   * was never examined is the one failure an upgrade check must not
   * have.
   */
  supportedTypes: string[] | null
  /** Why the capabilities could not be measured, when they could not. */
  unresolvedReason?: string
}

/**
 * Field capabilities for a whole installation, produced where the client
 * config can be loaded and consumed where the database can.
 */
export interface CapabilityManifest {
  generatedAt: string
  fields: FieldCapabilities[]
}

/** One stored value that this field's current configuration cannot take as-is. */
export interface ScanFinding {
  collectionPath: string
  /** Declaration path — the manifest key this value was matched against. */
  fieldPath: string
  /**
   * Instance path as stored, when the caller knows it —
   * `content.1.photoBlock.caption`. Two affected captions in one version
   * share a declaration path and are told apart only by this.
   */
  instancePath?: string
  documentId: string
  versionId: string
  locale?: string
  /** Structures that will be converted when the field opens this value. */
  adaptedTypes: string[]
  /** Structures with no conversion — the field will open read-only. */
  refusedTypes: string[]
  /**
   * Set when the field's capabilities were never measured, so this value
   * was not examined. Neither adapted nor refused: unknown.
   */
  unmapped?: true
}
