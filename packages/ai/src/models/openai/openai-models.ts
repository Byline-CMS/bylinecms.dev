/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import OpenAI from 'openai'

import { getAiServerConfig as getServerConfig } from '../../config/ai-config'

// Lists all available OpenAI models.
// Requires OPENAI_API_KEY obtained from https://platform.openai.com/api-keys

export type ModelInfo = {
  id: string
  name: string
  created: string
}

export async function listAllModels(): Promise<ModelInfo[]> {
  const openai = new OpenAI({ apiKey: getServerConfig().ai.openai.apiKey })
  const list = await openai.models.list()

  const models: ModelInfo[] = []
  for await (const model of list) {
    models.push({
      id: model.id,
      name: model.id,
      created: new Date(model.created * 1000).toISOString(),
    })
  }
  return models
}
