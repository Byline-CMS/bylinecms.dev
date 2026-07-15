import type { CollectionFieldData, CollectionFieldDataAllLocales } from '@byline/core'

import type { collections } from './collections/index.js'
import type {
  CollectionFieldsAllLocalesByPath,
  CollectionFieldsByPath,
} from './generated/collection-types.js'

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
