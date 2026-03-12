/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  ArrayField,
  BlocksField,
  Field,
  FieldSet,
  GroupField,
  LocalizedField,
  OptionalField,
  SelectField,
} from './field-types.js'
import type { StoredFileValue } from './stored-file-types.js'
import type { Prettify, ValueUnion } from './type-utils.js'

// The base data type for each field -- group, array, blocks and select are
// handled seprately (so the corresponding type here is `never`), but for the
// other leaf field types this is the underlying non-localized JS type.
type BaseFieldDataTypes = {
  array: never
  blocks: never
  boolean: boolean
  checkbox: boolean
  date: Date
  datetime: Date
  decimal: string
  float: number
  group: never
  integer: number
  json: unknown
  object: unknown
  richText: unknown
  select: never
  textArea: string
  text: string
  time: string
  relation: unknown // TODO: Should be a proper type akin to StoredFileValue
  file: StoredFileValue
  image: StoredFileValue
}

// -----------------------------------------------------------------------------
//  Field / FieldSet data for a single locale
// -----------------------------------------------------------------------------

// The base data type corresponding to a BlocksField definition, not considering
// the 'optional' modifier.
type BlocksFieldData<T extends BlocksField> = Array<
  Prettify<
    ValueUnion<{
      [K in T['blocks'][number] as K['blockType']]: Prettify<
        {
          _id: string
          _type: K['blockType']
        } & FieldSetData<K['fields']>
      >
    }>
  >
>

// The data type corresponding to the given Field definition, without
// considering the 'optional' modifier.
type BaseFieldData<T extends Field> = T extends ArrayField
  ? Array<Prettify<{ _id: string } & FieldSetData<T['fields']>>>
  : T extends BlocksField
    ? Prettify<BlocksFieldData<T>>
    : T extends GroupField
      ? FieldSetData<T['fields']>
      : T extends SelectField
        ? T['options'][number]['value']
        : BaseFieldDataTypes[T['type']]

// The data type corresponding to the given Field definition, taking into
// account the 'optional' modifier.
export type FieldData<T extends Field = Field> = T extends OptionalField
  ? BaseFieldData<T> | undefined
  : BaseFieldData<T>

// The data type corresponding to the given array of fields (i.e. the fields at
// top-level in a collection, or the fields within a group, array item, or
// block).
export type FieldSetData<T extends FieldSet = FieldSet> = Prettify<
  {
    -readonly [F in T[number] as F extends OptionalField ? never : F['name']]: FieldData<F>
  } & {
    -readonly [F in T[number] as F extends OptionalField ? F['name'] : never]?: FieldData<F>
  }
>

// -----------------------------------------------------------------------------
//  Field / FieldSet data for all locales at once
// -----------------------------------------------------------------------------

export type PerLocale<T> = {
  [locale: string]: T
}

type BlocksFieldDataAllLocales<T extends BlocksField> = Array<
  Prettify<
    ValueUnion<{
      [K in T['blocks'][number] as K['blockType']]: {
        _id: string
        _type: K['blockType']
      } & FieldSetDataAllLocales<K['fields']>
    }>
  >
>

type BaseFieldDataAllLocales<T extends Field> = T extends ArrayField
  ? Array<Prettify<{ _id: string } & FieldSetDataAllLocales<T['fields']>>>
  : T extends BlocksField
    ? Prettify<BlocksFieldDataAllLocales<T>>
    : T extends GroupField
      ? FieldSetDataAllLocales<T['fields']>
      : T extends SelectField
        ? T['options'][number]['value']
        : BaseFieldDataTypes[T['type']]

type LocalizedFieldDataAllLocales<T extends Field> = T extends LocalizedField
  ? PerLocale<BaseFieldDataAllLocales<T>>
  : BaseFieldDataAllLocales<T>

export type FieldDataAllLocales<T extends Field = Field> = T extends OptionalField
  ? LocalizedFieldDataAllLocales<T> | undefined
  : LocalizedFieldDataAllLocales<T>

export type FieldSetDataAllLocales<T extends FieldSet = FieldSet> = Prettify<
  {
    -readonly [F in T[number] as F extends OptionalField
      ? never
      : F['name']]: FieldDataAllLocales<F>
  } & {
    -readonly [F in T[number] as F extends OptionalField
      ? F['name']
      : never]?: FieldDataAllLocales<F>
  }
>
