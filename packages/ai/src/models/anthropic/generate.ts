import {
  generateDoc as generateNativeDoc,
  generateDocStreaming as generateNativeDocStreaming,
  generateHtml as generateNativeHtml,
  generateHtmlStreaming as generateNativeHtmlStreaming,
  generateText as generateNativeText,
  generateTextStreaming as generateNativeTextStreaming,
} from './generate-native'
import {
  generateDoc as generateVercelDoc,
  generateDocStreaming as generateVercelDocStreaming,
  generateHtml as generateVercelHtml,
  generateHtmlStreaming as generateVercelHtmlStreaming,
  generateText as generateVercelText,
  generateTextStreaming as generateVercelTextStreaming,
} from './generate-vercel'
import type { Sdk } from '@/@types'

export const getGenerateDoc = (sdk: Sdk) => {
  return sdk === 'vercel' ? generateVercelDoc : generateNativeDoc
}

export const getGenerateDocStreaming = (sdk: Sdk) => {
  return sdk === 'vercel' ? generateVercelDocStreaming : generateNativeDocStreaming
}

export const getGenerateHtml = (sdk: Sdk) => {
  return sdk === 'vercel' ? generateVercelHtml : generateNativeHtml
}

export const getGenerateHtmlStreaming = (sdk: Sdk) => {
  return sdk === 'vercel' ? generateVercelHtmlStreaming : generateNativeHtmlStreaming
}

export const getGenerateText = (sdk: Sdk) => {
  return sdk === 'vercel' ? generateVercelText : generateNativeText
}

export const getGenerateTextStreaming = (sdk: Sdk) => {
  return sdk === 'vercel' ? generateVercelTextStreaming : generateNativeTextStreaming
}
