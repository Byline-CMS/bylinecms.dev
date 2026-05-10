import {
  patchDoc as patchNativeDoc,
  patchDocStreaming as patchNativeDocStreaming,
} from './patch-native'
import {
  patchDoc as patchVercelDoc,
  patchDocStreaming as patchVercelDocStreaming,
} from './patch-vercel'
import type { Sdk } from '@/@types'

export const getPatchDoc = (sdk: Sdk) => {
  return sdk === 'vercel' ? patchVercelDoc : patchNativeDoc
}

export const getPatchDocStreaming = (sdk: Sdk) => {
  return sdk === 'vercel' ? patchVercelDocStreaming : patchNativeDocStreaming
}
