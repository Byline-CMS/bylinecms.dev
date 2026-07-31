---
title: "Fields API"
path: "field-reference"
summary: "All 22 built-in field kinds, common schema properties, type-specific options, inferred value shapes, defaults, validation, hooks, localization, and admin overrides."
---

# Fields API

Companions:
- [Fields](../04-collections/01-fields.md) — recipes and explanation for schema helpers, admin helpers, component slots, conditions, and cross-field writes.
- [Collections API](./02-collections.md) — the collection and block definitions that contain field arrays.
- [Relationships](../04-collections/03-relationships.md) — relation envelopes, population, filters, and `hasMany` behavior.
- [File and media uploads](../04-collections/06-file-media-uploads.md) — `UploadConfig`, stored file values, storage routing, variants, and upload hooks.
- [Rich text](../04-collections/07-rich-text.md) — Lexical `EditorConfig`, extensions, relation modes, and server adapters.

This reference lists every field kind accepted by `CollectionDefinition.fields` and `Block.fields`. A field is a discriminated object whose `type` selects its value shape and type-specific options.

## Common field properties

Every field accepts these properties in addition to its required `name` and `type`.

| Property | Default | Description |
|---|---|---|
| `name` | Required | Stable field key. It participates in schema paths, generated types, storage paths, and API values. Reserved system names are rejected. |
| `type` | Required | One of the 22 field discriminators listed below. |
| `label` | Derived by the UI | Human-readable admin label. |
| `helpText` | None | Supporting text rendered with the input. |
| `placeholder` | None | Placeholder hint forwarded by widgets that support it. |
| `optional` | `false` | Makes the generated property optional and permits an absent value. Fields are required by default. |
| `readOnly` | `false` | Admin rendering hint. It is not server-side immutability or an authorization boundary. |
| `hooks` | None | Client-side `beforeValidate` and `beforeChange` hook slots. |
| `condition` | None | Client-side visibility predicate over the full form data and current sibling scope. Hidden values remain stored. |
| `virtual` | `false` | Makes the value available to form state and lifecycle hooks but excludes it from persistence. |
| `validate` | None | Submit-time validator `(value, data) => string \| undefined` available on every field, including structure fields. |
| `localized` | `false` | Available only on localizable field kinds. Stores a distinct value per content locale when `true`. |

### `optional`

An optional field becomes an optional property in inferred and generated object types. The value type also permits `undefined`.

```ts
{ name: 'subtitle', type: 'text', optional: true }
// Inferred shape: subtitle?: string | undefined
```

### `readOnly`

`readOnly` prevents normal editing in widgets that implement the hint. API clients can still submit the field. Enforce security and immutability in abilities, hooks, lifecycle services, or a field-specific server rule.

### `condition`

```ts
type FieldCondition = (
  data: Record<string, any>,
  siblingData: Record<string, any>
) => boolean
```

The admin re-evaluates the condition as form data changes. Hidden fields retain their values and are exempt from client validation while hidden. A conditionally hidden required field should normally be `optional` or have a default.

```ts
{
  name: 'thumbnailCaption',
  type: 'text',
  optional: true,
  condition: (_data, siblings) => Boolean(siblings.generateThumbnail),
}
```

### `virtual`

A virtual value reaches `beforeCreate`, `afterCreate`, `beforeUpdate`, and `afterUpdate`, but the storage flatten pass writes no row for it. It is absent on the next read.

Boot validation enforces these constraints:

- it must be optional or declare a `defaultValue`;
- it cannot be a `counter`;
- an upload-capable `file` or `image` cannot be virtual; and
- `useAsTitle`, `useAsPath`, and search configuration cannot reference it.

Setting `virtual` on `group`, `array`, or `blocks` omits the entire subtree.

## Field kind index

Byline has three structure fields and 19 value fields.

| `type` | Value shape | Localizable | Type-specific properties |
|---|---|---|---|
| `group` | Object from nested fields | No | `fields` |
| `array` | Ordered array of `{ _id, ...fields }` | No | `fields`, `validation.minLength`, `validation.maxLength` |
| `blocks` | Ordered discriminated block array | No | `blocks` |
| `text` | `string` | Yes | `defaultValue`, length/pattern/rule validation |
| `textArea` | `string` | Yes | `defaultValue`, length/pattern/rule validation |
| `code` | `string` | Yes | `defaultValue`, `language`, `languageField`, length/rule validation |
| `checkbox` | `boolean` | No | `defaultValue` |
| `boolean` | `boolean` | No | `defaultValue` |
| `select` | Declared option-value union | No | `options`, `defaultValue` |
| `richText` | JSON value | Yes | `defaultValue`, length validation, `editorConfig`, relation-mode flags |
| `time` | `string` | No | `defaultValue` |
| `date` | `Date` | No | `defaultValue` |
| `datetime` | `Date` | No | `mode`, `yearsInFuture`, `yearsInPast`, `defaultValue` |
| `float` | `number` | No | `defaultValue`, `validation.min`, `validation.max` |
| `integer` | `number` | No | `defaultValue`, `validation.min`, `validation.max` |
| `decimal` | `string` | No | `defaultValue` |
| `counter` | `number` | No | `group` |
| `json` | JSON value | Yes | `defaultValue` |
| `object` | JSON object | Yes | `defaultValue` |
| `relation` | Relation envelope or ordered envelope array | No | `targetCollection`, `displayField`, `hasMany`, `minItems`, `maxItems` |
| `file` | `StoredFileValue` | No | `upload` |
| `image` | `StoredFileValue` | No | `upload` |

Array and block `_id` values are synthetic identity metadata. They stabilize editing and ordering but are not user schema data.

## Structure fields

### `group`

```ts
interface GroupField {
  name: string
  type: 'group'
  fields: readonly Field[]
}
```

Groups assemble nested fields into one object without creating a repeated item boundary.

```ts
{
  name: 'seo',
  type: 'group',
  fields: [
    { name: 'title', type: 'text', optional: true },
    { name: 'description', type: 'textArea', optional: true },
  ],
}
```

### `array`

```ts
interface ArrayField {
  name: string
  type: 'array'
  fields: readonly Field[]
  validation?: { minLength?: number; maxLength?: number }
}
```

Each stored item gains a synthetic `_id`. Array values preserve order.

```ts
{
  name: 'authors',
  type: 'array',
  validation: { minLength: 1, maxLength: 10 },
  fields: [
    { name: 'name', type: 'text' },
    { name: 'role', type: 'text', optional: true },
  ],
}
```

### `blocks`

```ts
interface BlocksField {
  name: string
  type: 'blocks'
  blocks: Block[]
}
```

Each block value contains synthetic `_id` identity and a `_type` discriminator equal to the definition's `blockType`.

```ts
{
  name: 'content',
  type: 'blocks',
  blocks: [RichTextBlock, PhotoBlock, QuoteBlock],
}
```

## Text fields

### `text` and `textArea`

```ts
interface TextFieldOptions {
  defaultValue?: DefaultValue<string>
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
    rules?: ValidationRule[]
  }
}
```

Both store strings and support localization. They differ in their default admin widget.

### `code`

```ts
interface CodeFieldOptions {
  defaultValue?: DefaultValue<string>
  language?: string
  languageField?: string
  validation?: {
    minLength?: number
    maxLength?: number
    rules?: ValidationRule[]
  }
}
```

`language` sets the default syntax-highlighting language. `languageField` names a sibling string field whose live value overrides it. Both affect presentation only; storage contains the source string.

## Choice fields

### `checkbox` and `boolean`

Both store `boolean` and accept `defaultValue?: DefaultValue<boolean>`. They remain separate discriminators so admin widgets and semantics can differ.

### `select`

```ts
interface SelectFieldOption {
  label: string
  value: string
}

interface SelectField {
  type: 'select'
  options: [SelectFieldOption, ...SelectFieldOption[]]
  defaultValue?: DefaultValue<string>
}
```

The options array must be non-empty. `defineCollection()` preserves literal values so generated types become their union.

```ts
{
  name: 'format',
  type: 'select',
  options: [
    { label: 'Article', value: 'article' },
    { label: 'Report', value: 'report' },
  ],
  defaultValue: 'article',
}
```

## Rich text

```ts
interface RichTextFieldOptions {
  defaultValue?: DefaultValue<unknown>
  validation?: { minLength?: number; maxLength?: number }
  editorConfig?: unknown
  embedRelationsOnSave?: boolean
  populateRelationsOnRead?: boolean
}
```

| Property | Default | Description |
|---|---|---|
| `editorConfig` | Adapter defaults | Serializable editor-specific data. For Lexical this is `EditorConfig`. It does not replace the React editor component. |
| `embedRelationsOnSave` | `true` | Refreshes relation-bearing nodes during writes through the registered server embed adapter. |
| `populateRelationsOnRead` | Inverse of `embedRelationsOnSave` | Refreshes relation-bearing nodes during reads through the registered server populate adapter. |

At least one relation mode must be effective. Setting both flags to `false` fails boot validation. Setting both to `true` embeds on write and refreshes on read.

[Rich text](../04-collections/07-rich-text.md) documents Lexical configuration, extensions, markdown, toolbar contributions, and server adapters.

## Date, time, and numeric fields

### `time`

Stores a time string and accepts `defaultValue?: DefaultValue<string>`.

### `date`

Uses a `Date` value and accepts `defaultValue?: DefaultValue<Date>`.

### `datetime`

```ts
interface DateTimeFieldOptions {
  mode?: 'date' | 'datetime'
  yearsInFuture?: number
  yearsInPast?: number
  defaultValue?: DefaultValue<Date>
}
```

`mode` controls the admin input mode. The year-range values bound the date picker.

### `float` and `integer`

```ts
interface NumericFieldOptions {
  defaultValue?: DefaultValue<number>
  validation?: { min?: number; max?: number }
}
```

Both restore as JavaScript `number`; `integer` uses integer storage and validation semantics.

### `decimal`

Decimal values are precision-preserving strings, not JavaScript numbers.

```ts
{ name: 'price', type: 'decimal', defaultValue: '0.00' }
```

## Allocated and JSON fields

### `counter`

```ts
interface CounterField {
  type: 'counter'
  group: string
}
```

The lifecycle allocates an immutable monotonically increasing integer at create time. Counter fields sharing the same stable `group` share one sequence across collections. Gaps can occur after rollbacks and deletes. A counter has no default or validation slot and cannot appear inside arrays or blocks.

### `json`

Stores any JSON value and supports localization.

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
```

### `object`

Stores a JSON object and supports localization.

```ts
type JsonObject = { [key: string]: JsonValue }
```

## Relations

```ts
interface RelationField {
  type: 'relation'
  targetCollection: string
  displayField?: string
  hasMany?: boolean
  minItems?: number
  maxItems?: number
}
```

| Property | Default | Description |
|---|---|---|
| `targetCollection` | Required | Target collection path. |
| `displayField` | Target identity fallback | Target field displayed in the picker and inline summary. |
| `hasMany` | `false` | Changes the value from one envelope to an ordered array of envelopes. |
| `minItems` | None | Minimum array length when `hasMany` is true. |
| `maxItems` | None | Maximum array length when `hasMany` is true. |

The canonical unpopulated value is `RelatedDocumentValue`; population adds a target `ClientDocument` under `.document`. [Relationships](../04-collections/03-relationships.md) documents all envelope states and the populate DSL.

## File and image fields

```ts
interface FileField {
  type: 'file'
  upload?: UploadConfig
}

interface ImageField {
  type: 'image'
  upload?: UploadConfig
}
```

Both restore a `StoredFileValue`. Adding `upload` makes that field upload-capable and mounts it on the collection upload transport. Image processing depends on MIME type and configured sizes, not on whether the discriminator is `file` or `image`.

The complete `UploadConfig`, `ImageSize`, storage precedence, hook, transport, and stored-value contracts are in [File and media uploads](../04-collections/06-file-media-uploads.md#uploadconfig-reference).

## Default values

Value fields that expose `defaultValue` accept a literal or a synchronous/async factory:

```ts
type DefaultValue<T> =
  | T
  | ((ctx: {
      data: Record<string, any>
      locale?: string
      now: () => Date
      uuid?: () => string
    }) => T | Promise<T>)
```

```ts
{
  name: 'publishedOn',
  type: 'datetime',
  defaultValue: ({ now }) => now(),
}
```

## Validation

### `validation`

Type-specific `validation` objects provide declarative length, range, pattern, or rule checks. Supported generic rules are:

```ts
interface ValidationRule {
  type: 'min' | 'max' | 'pattern' | 'custom' | 'email' | 'url'
  value: any
  message?: string
}
```

### `validate`

Every field also accepts a submit-time function:

```ts
validate?: (value: any, data: Record<string, any>) => string | undefined
```

Return a non-empty string to block submission and display the field error.

## Field hooks

```ts
interface FieldHooks {
  beforeValidate?: FieldBeforeValidateFn | FieldBeforeValidateFn[]
  beforeChange?: FieldBeforeChangeFn | FieldBeforeChangeFn[]
}
```

Both receive the changing value, previous value, full form data, instance path, field definition, operation (`change` or `submit`), and `setFieldValue(path, value)`.

| Hook | Effect |
|---|---|
| `beforeValidate` | Runs before built-in validation. Returning `{ error }` is advisory: the value is still committed, but the error is displayed. |
| `beforeChange` | Runs before the form write. Returning `{ value }` replaces the value; returning `{ error }` blocks the write. |

`setFieldValue()` writes another field and emits its patch without running the target field's hooks, preventing hook recursion.

## Admin field overrides

```ts
interface FieldAdminConfig {
  components?: {
    Label?: SlotComponent<FieldLabelSlotProps>
    HelpText?: SlotComponent<FieldHelpTextSlotProps>
    Field?: SlotComponent<FieldInputSlotProps>
    beforeField?: SlotComponent<FieldAdornmentSlotProps>
    afterField?: SlotComponent<FieldAdornmentSlotProps>
  }
  editor?: RichTextEditorComponent
}
```

| Property | Description |
|---|---|
| `components.Label` | Replaces the default label. |
| `components.HelpText` | Replaces the default help text. |
| `components.Field` | Replaces the complete value-field input and must call `onChange`. |
| `components.beforeField` | Renders between label and input. |
| `components.afterField` | Renders between input and help text. |
| `editor` | Replaces the React editor for this rich-text field only. Ignored for other field types. |

Collection overrides are keyed by index-free schema path in `CollectionAdminConfig.fields`. Block overrides are keyed relative to the block root in `BlockAdminConfig.fields`.

## Field helper and inference functions

| Symbol | Purpose |
|---|---|
| `defineField(definition)` | Identity helper that preserves one field's literal type information. |
| `CollectionFieldData<C>` | Infers a collection's ordinary single-locale field object. |
| `CollectionFieldDataAllLocales<C>` | Infers its all-locales field object. |
| `BlockFieldData<B>` | Infers one block's ordinary field object. |
| `BlockFieldDataAllLocales<B>` | Infers one block's all-locales field object. |
| `isStructureField(field)` | Narrows to `group`, `array`, or `blocks`. |
| `isArrayField(field)` | Narrows to `ArrayField`. |
| `isBlocksField(field)` | Narrows to `BlocksField`. |
| `isGroupField(field)` | Narrows to `GroupField`. |
| `isValueField(field)` | Narrows to the 19 value-field kinds. |
