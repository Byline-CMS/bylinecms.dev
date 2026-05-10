/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { GoogleGenAI } from '@google/genai'

import { getAiServerConfig as getServerConfig } from '../../config/ai-config'

// Lists all available Google Generative AI models.
// Requires GOOGLE_API_KEY obtained from https://console.cloud.google.com/apis/credentials or
// https://aistudio.google.com/u/2/api-key

export type ModelInfo = {
  id: string
  name: string
  description: string
}

export async function listAllModels(): Promise<ModelInfo[]> {
  const ai = new GoogleGenAI({ apiKey: getServerConfig().ai.google.apiKey })

  const models: ModelInfo[] = []
  const modelsPager = await ai.models.list()
  for await (const model of modelsPager) {
    if (model?.supportedActions?.includes('generateContent')) {
      models.push({
        id: model.name ?? '',
        name: model.displayName ?? model.name ?? '',
        description: model.description ?? '',
      })
    }
  }
  return models
}
