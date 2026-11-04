---
"@byline/core": minor
"@byline/extraction-conformance": minor
---

Added provisional extraction provider contracts and source verification. `@byline/core` now exports the provider, result, artifact and page map types, typed failures, the producer hash, the evidence and artifact validators, `decideExtractionWork` and `exclusionState`. `@byline/core/stored-files` adds `readVerifiedSource` and `probeVerifiedSource`, which only expose bytes that match the saved `fileHash`. The new `@byline/extraction-conformance` package tests a provider against the contract. These APIs are provisional: until the contract is declared stable, a minor release may change them, and the changelog will say so. Byline does not yet ship an extraction store, worker, search join or reference driver.
