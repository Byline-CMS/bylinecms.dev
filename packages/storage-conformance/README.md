# @byline/storage-conformance

Private, provider-neutral behavioral suites for Byline `IStorageProvider`
implementations. The package owns no storage implementation. Each provider
package runs the suite from its own tests against a fresh store:

```ts
runStorageProviderConformanceSuite({
  name: 'storage-local',
  createProvider: () => localStorageProvider({ uploadDir, baseUrl: '/uploads' }),
  validatorKinds: ['local-stat'],
  extraReplacers, // optional provider-specific same-path replacement paths
  teardown,
})
```

The suite covers stored-file content identity (see
`specs/2026-10-31-stored-file-identity-spec.md` §5):

- upload validators and `head` agreement;
- a new validator and content hash for changed bytes at the same path, and an
  unchanged hash for unchanged bytes;
- bound reads (`download`) returning the exact bytes with their validator;
- fail-closed `expect` preconditions (`changed`, `unsupported-kind`, `missing`);
- `null` for missing objects;
- providers without `head` or `download`; and
- a reader opened before a same-path replacement (by upload, by move, and by
  any provider-specific path) keeping the old bytes and validator.

The provider under test must implement `download` and `head`.
