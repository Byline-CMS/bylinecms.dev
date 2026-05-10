import Anthropic from '@anthropic-ai/sdk'

import { getAiServerConfig } from '../../config/ai-config'

// Lists all available Anthropic models.
// Requires ANTHROPIC_API_KEY obtained from https://console.anthropic.com/api-keys

export type ModelInfo = {
  id: string
  name: string
  created: string
}

const isValidHttpUrl = (value: string | undefined): value is string => {
  if (value == null || value.trim().length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function listAllModels(): Promise<ModelInfo[]> {
  const config = getAiServerConfig()
  const baseURL = isValidHttpUrl(config.ai.anthropic.baseUrl)
    ? config.ai.anthropic.baseUrl
    : 'https://api.anthropic.com'

  const client = new Anthropic({
    apiKey: config.ai.anthropic.apiKey,
    baseURL,
  })

  const models: ModelInfo[] = []
  const modelsPager = await client.models.list()
  for await (const model of modelsPager) {
    models.push({
      id: model.id,
      name: model.display_name,
      created: model.created_at,
    })
  }
  return models
}
