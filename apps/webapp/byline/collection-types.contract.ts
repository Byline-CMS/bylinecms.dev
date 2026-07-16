/**
 * Compile-time contract between this application's collection schemas and its
 * generated collection-type projection.
 *
 * ```text
 * collections/index.ts                  generated/collection-types.ts
 *   `typeof collections`                 `CollectionFields*ByPath`
 *            |                                      |
 *            v                                      v
 *    inferred registry ----------- Exact -------- generated registry
 *                                    |
 *                                    v
 *                         TypeScript error on drift
 * ```
 *
 * The generated file is deliberately a standalone projection for typed clients
 * and frontend code; it does not import the runtime schemas. This module joins
 * those two app-owned sources at compile time and requires their collection
 * keys, ordinary field shapes, and all-locale field shapes to match exactly.
 *
 * This file has no runtime behavior. Keep it application-owned: `@byline/core`
 * provides the inference and code-generation machinery, but only this
 * application knows its concrete collection tuple and generated output.
 */

import type { CollectionFieldData, CollectionFieldDataAllLocales } from '@byline/core'
import type {
  CollectionFieldsAllLocalesByPath,
  CollectionFieldsByPath,
} from '@byline/generated-types'

import type { collections } from './collections/index.js'

type InferredFieldsByPath = {
  [Definition in (typeof collections)[number] as Definition['path']]: CollectionFieldData<Definition>
}

type InferredFieldsAllLocalesByPath = {
  [Definition in (typeof collections)[number] as Definition['path']]: CollectionFieldDataAllLocales<Definition>
}

type IsAny<Value> = 0 extends 1 & Value ? true : false
type Exact<Left, Right> =
  IsAny<Left> extends true
    ? IsAny<Right>
    : IsAny<Right> extends true
      ? false
      : (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
        ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
          ? true
          : false
        : false
type Assert<Value extends true> = Value

type GeneratedKeysMatchRuntimeRegistry = Assert<
  Exact<keyof CollectionFieldsByPath, keyof InferredFieldsByPath>
>
type GeneratedFieldsMatchRuntimeRegistry = Assert<
  Exact<CollectionFieldsByPath, InferredFieldsByPath>
>
type GeneratedAllLocalesKeysMatchRuntimeRegistry = Assert<
  Exact<keyof CollectionFieldsAllLocalesByPath, keyof InferredFieldsAllLocalesByPath>
>
type GeneratedAllLocalesFieldsMatchRuntimeRegistry = Assert<
  Exact<CollectionFieldsAllLocalesByPath, InferredFieldsAllLocalesByPath>
>
