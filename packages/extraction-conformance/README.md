# @byline/extraction-conformance

A Vitest kit that tests whether a Byline extraction provider honours the provider
contract. Use it when you are writing or changing a driver for an extractor such as
Apache Tika, Docling, an OCR service, or a hosted vision model.

The contract and this kit are **provisional**. Until the contract is declared stable,
a minor release may change them, and the changelog will say so.

## Install

The kit needs Vitest as a peer dependency, and it uses the same version of
`@byline/core` as the rest of your Byline packages.

```sh
pnpm add -D @byline/extraction-conformance vitest
```

## Run the kit against a driver

Call `defineExtractionProviderConformance` at the top level of a test file.

```ts
import { defineExtractionProviderConformance } from '@byline/extraction-conformance'

import { createMyDriver } from './my-driver.js'

defineExtractionProviderConformance({
  name: 'my-driver',
  createProvider: () => createMyDriver({ url: process.env.DRIVER_URL ?? '' }),
  createUnavailableProvider: () => createMyDriver({ url: 'http://127.0.0.1:9' }),
})
```

| Hook | Required | Purpose |
|---|---|---|
| `name` | Yes | Shown in the suite name |
| `createProvider` | Yes | A provider connected to a working engine |
| `createUnavailableProvider` | No | A provider whose service cannot be reached. Without it, case 6 is skipped |
| `timeoutMs` | No | The timeout per case. The default is 60 seconds, for remote engines |

Run it against a real engine. A fake that imitates your engine shows only that the
fake passes. A case is skipped rather than passed when it does not apply, for example
the page map case for a driver that declares `capabilities.pageMap` as `false`.

## What the kit checks

The nine cases cover capability honesty, result shape, sentinel text, page map
sentinels, typed file failures, typed infrastructure failures, abort, input forms, and
version consistency. The [extraction provider contract](https://github.com/Byline-CMS/bylinecms.dev/blob/develop/docs/06-search/10-extraction-provider-contract.md#conformance-kit)
describes each one.

- **Only the page map sentinel case makes a provenance claim.** A map can pass
  `validatePageMap` with its pages in the wrong order. That case confirms that each
  sentinel lies in the page it came from.
- **A truncated PDF may resolve.** A parser that recovers a damaged file has not
  failed, so the kit accepts either a typed `file` failure or a valid result. A corrupt
  file must reject with a typed `file` failure.
- **OCR, tables, formulas, and charts are not verified.** Those capabilities are
  declared by the author.

## Fixtures

| File | Contents |
|---|---|
| `fixtures/sentinel.pdf` | Three born-digital pages, with one unique sentinel per page (`BYLINE-SENTINEL-PAGE-1` and so on) |
| `fixtures/truncated.pdf` | The first half of `sentinel.pdf`, with no cross-reference table |
| `fixtures/corrupt.pdf` | A PDF header followed by bytes with no PDF structure to recover |

The fixtures are hand-written PDF syntax, with no dependencies. To regenerate them from
the script shipped with the package:

```sh
node node_modules/@byline/extraction-conformance/scripts/generate-fixtures.mjs ./out
```

An engine's result for these fixtures describes that engine only. If a legitimate
engine recovers the corrupt fixture, please report it rather than treating the driver
as defective.

## Use the cases without Vitest's wrapper

Each case is a plain async function in `extractionProviderConformanceCases`. A case
resolves when the provider passes, resolves with `{ skipped }` when it does not apply,
and rejects with `ConformanceFailure` otherwise. Pass it your hooks and the result of
`loadFixtures()`. The package root still imports Vitest, so Vitest must be installed.

## License

MPL-2.0.
