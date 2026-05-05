/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Storage-agnostic image-processing helpers (sharp-backed). Lives in the
 * neutral `@byline/core/image` subpath so any storage provider —
 * `@byline/storage-local`, `@byline/storage-s3`, future providers — can
 * consume the same metadata extraction and variant generation utilities
 * without taking a dependency on a sibling provider package.
 */

export {
  extractImageMeta,
  generateImageVariants,
  isBypassMimeType,
} from './image-processor.js'
export type {
  ImageMeta,
  ImageVariantResult,
  ProcessImageResult,
} from './image-processor.js'
