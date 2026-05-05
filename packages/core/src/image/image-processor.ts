/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import path from 'node:path'

// Sharp ships its own types; no @types/sharp needed.
import sharp from 'sharp'

import type { ImageSize } from '../@types/collection-types.js'
import type { IStorageProvider, StoredFileLocation } from '../@types/storage-types.js'
import type { BylineLogger } from '../logger/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageMeta {
  width: number | null
  height: number | null
  format: string | null
}

export interface ImageVariantResult {
  name: string
  storagePath: string
  width: number | undefined
  height: number | undefined
  format: string
}

export interface ProcessImageResult {
  meta: ImageMeta
  variants: ImageVariantResult[]
}

// ---------------------------------------------------------------------------
// SVG detection
// ---------------------------------------------------------------------------

/**
 * Returns true for MIME types that should skip Sharp processing.
 * SVGs are vector files — Sharp cannot meaningfully resize or convert them,
 * and they do not benefit from the responsive-image pipeline.
 */
export function isBypassMimeType(mimeType: string): boolean {
  return mimeType === 'image/svg+xml' || mimeType === 'image/gif'
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

/**
 * Extract basic image metadata (dimensions + format) from a buffer using Sharp.
 * Returns nulls for non-image or unrecognised formats.
 */
export async function extractImageMeta(buffer: Buffer, mimeType: string): Promise<ImageMeta> {
  if (isBypassMimeType(mimeType)) {
    // For SVGs, attempt a lightweight XML parse for width/height attributes.
    const svgMeta = tryParseSvgDimensions(buffer)
    return { width: svgMeta.width, height: svgMeta.height, format: 'svg' }
  }

  try {
    const metadata = await sharp(buffer).metadata()
    return {
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
    }
  } catch {
    return { width: null, height: null, format: null }
  }
}

/**
 * A lightweight SVG width/height parser — avoids pulling in a full XML library.
 * Only reads the root `<svg>` element's `width` and `height` attributes.
 */
function tryParseSvgDimensions(buffer: Buffer): { width: number | null; height: number | null } {
  try {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 2048))
    const widthMatch = text.match(/<svg[^>]*\swidth=["']([0-9.]+)(?:px)?["']/)
    const heightMatch = text.match(/<svg[^>]*\sheight=["']([0-9.]+)(?:px)?["']/)
    return {
      width: widthMatch ? Math.round(Number.parseFloat(widthMatch[1]!)) : null,
      height: heightMatch ? Math.round(Number.parseFloat(heightMatch[1]!)) : null,
    }
  } catch {
    return { width: null, height: null }
  }
}

// ---------------------------------------------------------------------------
// Variant generation
// ---------------------------------------------------------------------------

/**
 * Map a Sharp output format keyword to the corresponding image MIME type.
 * Unknown formats fall back to `application/octet-stream` — the storage
 * provider will accept it; only the served `Content-Type` is affected.
 */
function mimeTypeForFormat(format: string): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Generate the named image variants (sizes) defined in `UploadConfig.sizes`
 * and persist them through the configured `IStorageProvider`.
 *
 * - SVG and GIF files are skipped entirely (bypass types).
 * - Each variant is uploaded as a sibling object to `storedFile.storagePath`,
 *   using the naming convention: `<dir>/<basename>-<variantName>.<ext>`
 *   (POSIX paths — both local filesystem keys and S3 object keys).
 * - Variant bytes are produced in-memory by Sharp and written via
 *   `storage.upload(buffer, { targetStoragePath })` — no direct filesystem
 *   access, so the function is provider-agnostic.
 * - Returns an array of `ImageVariantResult` describing what was created.
 */
export async function generateImageVariants(
  sourceBuffer: Buffer,
  mimeType: string,
  storedFile: StoredFileLocation,
  storage: IStorageProvider,
  sizes: ImageSize[],
  logger?: BylineLogger
): Promise<ImageVariantResult[]> {
  if (isBypassMimeType(mimeType) || sizes.length === 0) {
    return []
  }

  // Storage paths are POSIX-style across providers; use `path.posix` so
  // Windows local-fs hosts don't introduce backslashes into S3 object keys.
  const sourcePath = storedFile.storagePath
  const originalExt = path.posix.extname(sourcePath)
  const originalBase = path.posix.basename(sourcePath, originalExt)
  const variantDir = path.posix.dirname(sourcePath)
  const variants: ImageVariantResult[] = []

  for (const size of sizes) {
    const outputFormat = size.format ?? 'webp'
    const variantFilename = `${originalBase}-${size.name}.${outputFormat}`
    const variantStoragePath =
      variantDir === '.' ? variantFilename : `${variantDir}/${variantFilename}`

    try {
      let pipeline = sharp(sourceBuffer)

      const resizeOptions: sharp.ResizeOptions = {
        width: size.width,
        height: size.height,
        fit: (size.fit as sharp.FitEnum[keyof sharp.FitEnum]) ?? 'cover',
        withoutEnlargement: true,
      }

      pipeline = pipeline.resize(resizeOptions)

      // Apply format + quality.
      switch (outputFormat) {
        case 'jpeg':
          pipeline = pipeline.jpeg({ quality: size.quality ?? 85 })
          break
        case 'png':
          pipeline = pipeline.png({ quality: size.quality ?? 85 })
          break
        case 'webp':
          pipeline = pipeline.webp({ quality: size.quality ?? 85 })
          break
        case 'avif':
          pipeline = pipeline.avif({ quality: size.quality ?? 55 })
          break
        default:
          pipeline = pipeline.webp({ quality: size.quality ?? 85 })
      }

      const variantBuffer = await pipeline.toBuffer()
      const sharpMeta = await sharp(variantBuffer).metadata()

      await storage.upload(variantBuffer, {
        filename: variantFilename,
        mimeType: mimeTypeForFormat(outputFormat),
        size: variantBuffer.byteLength,
        targetStoragePath: variantStoragePath,
      })

      variants.push({
        name: size.name,
        storagePath: variantStoragePath,
        width: sharpMeta.width,
        height: sharpMeta.height,
        format: outputFormat,
      })
    } catch (err: unknown) {
      logger?.error({ err, variant: size.name }, 'failed to generate image variant')
      // Non-fatal: skip this variant but continue with others.
    }
  }

  return variants
}
