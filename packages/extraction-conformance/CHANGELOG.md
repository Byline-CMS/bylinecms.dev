# @byline/extraction-conformance

## 6.13.1

### Patch Changes

- fixed thrown server-function responses reaching the client as 200 under nitro 3 release candidates by disabling srvx fastresponse in **`@byline/host-tanstack-start`** hosts, and pinned nitro 3.0.261029-rc in **`@byline/cli`**
- Updated dependencies
  - @byline/core@6.13.1

## 6.13.0

### Minor Changes

- 5ae6b48: Added provisional extraction provider contracts and source verification. `@byline/core` now exports the provider, result, artifact and page map types, typed failures, the producer hash, the evidence and artifact validators, `decideExtractionWork` and `exclusionState`. `@byline/core/stored-files` adds `readVerifiedSource` and `probeVerifiedSource`, which only expose bytes that match the saved `fileHash`. The new `@byline/extraction-conformance` package tests a provider against the contract. These APIs are provisional: until the contract is declared stable, a minor release may change them, and the changelog will say so. Byline does not yet ship an extraction store, worker, search join or reference driver.
- added provisional extraction provider contracts, verified source reads and the new **`@byline/extraction-conformance`** kit

### Patch Changes

- Updated dependencies [5ae6b48]
- Updated dependencies
  - @byline/core@6.13.0
