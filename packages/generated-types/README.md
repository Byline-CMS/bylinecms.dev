# @byline/generated-types

A deliberately empty **declaration-merge target** for application-generated
Byline collection types.

Each application's `generate-types` script (backed by `@byline/core/codegen`)
emits its collection field types *into* this module via TypeScript module
augmentation. With the generated file in your app's TypeScript program:

```ts
import type { NewsFields, MediaFields } from '@byline/generated-types'
```

resolves to your app's own schema-derived types. Imports are type-only —
nothing is loaded at runtime.

Constraint: exactly one application per TypeScript program can augment this
module (declaration merging is global to the program). One app per tsconfig —
the supported layout — is safe.

Part of [Byline CMS](https://github.com/Byline-CMS/bylinecms.dev). MPL-2.0.
