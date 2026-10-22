---
'@byline/core': patch
---

Fix `where` operator objects that contain more than one operator. Earlier
versions silently applied only the first operator, so
`{ price: { $gte: 10, $lte: 20 } }` compiled to `price >= 10` and returned rows
outside the range. Every operator in the object now applies, ANDed together, at
every scope: top-level fields, `status` / `path` / `id`, relation sub-wheres, and
`$some` / `$every` / `$none` quantifiers.

**Behaviour change.** If you relied on the truncation, for example by passing a
range whose later bound was wrong, queries now return fewer rows. Single-operator
objects, bare values, and `$and` / `$or` workarounds such as
`{ $and: [{ f: { $gte: A } }, { f: { $lte: B } }] }` behave as before.

Input that could not be honoured is now rejected with `ERR_VALIDATION` instead of
being dropped:

- an empty operator object (`{ views: {} }`), including one whose operators are all
  `undefined`
- an unknown operator (`{ views: { $gte: 10, $bogus: 1 } }`)
- an array in place of a value or operator object
- an `$and` / `$or` value that is not an array

A top-level `status` operator object, such as `{ status: { $in: ['draft'] } }`, was
also dropped and now applies as a filter. Strict `beforeRead` predicates accept
multi-operator objects and validate every operator in them.
