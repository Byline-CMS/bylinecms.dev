/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// A value that can be awaited to produce a value of type T.
export type MaybePromise<T> = T | Promise<T>

// An array with at least one item.
export type NonEmptyArray<T> = [T, ...T[]]

// Makes some object types a little easier on the eyes.
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

// Recursively removes 'readonly' from all properties.
export type DeepMutable<T> =
  T extends ReadonlyArray<infer U>
    ? Array<DeepMutable<U>>
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T

// Given an object type T, produces a union of the types of its values.  As a
// simple example, if T is { a: string, b: number }, then ValueUnion<T> would be
// string | number.
export type ValueUnion<T extends Record<string, any>> = T[keyof T]
