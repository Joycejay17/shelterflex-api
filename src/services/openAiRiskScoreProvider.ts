/**
 * Claude-based AI risk scorer (Anthropic SDK, structured tool output).
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AiScoringConfig } from '../config/aiScoring.js'
import {
  RISK_SCORING_SYSTEM_PROMPT,
  RISK_SCORING_TOOL_NAME,
  RISK_SCORING_TOOL_INPUT_SCHEMA,
  buildRiskScoringUserMessage,
} from '../templates/ai/riskScoringPrompt.js'
import type {
  AiRiskScoreProvider,
  AiRiskScoreResult,
  TenantRiskProfile,
} from './aiRiskScoreProvider.js'
import { normalizeAiRiskScoreResult } from './aiRiskScoreProvider.js'

export class OpenAiRiskScoreProvider implements AiRiskScoreProvider {
  private client: Anthropic
  private model: string

  constructor(config: AiScoringConfig) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required when AI_SCORING_PROVIDER=claude')
    }
    this.client = new Anthropic({ apiKey: config.anthropicApiKey })
    this.model = config.model
  }

  async score(profile: TenantRiskProfile): Promise<AiRiskScoreResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: RISK_SCORING_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildRiskScoringUserMessage(profile) }],
      tools: [
        {
          name: RISK_SCORING_TOOL_NAME,
          description: 'Structured tenant risk assessment output',
          input_schema: RISK_SCORING_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: RISK_SCORING_TOOL_NAME },
    })

    const toolBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    )
    if (!toolBlock || toolBlock.name !== RISK_SCORING_TOOL_NAME) {
      throw new Error('Claude risk scoring response missing expected tool_use block')
    }

    const input = toolBlock.input as Record<string, unknown>
    return normalizeAiRiskScoreResult({
      score: Number(input.score),
      confidence: Number(input.confidence),
      riskBand: String(input.riskBand),
      contributingFactors: Array.isArray(input.contributingFactors)
        ? (input.contributingFactors as string[])
        : [],
      modelVersion: String(input.modelVersion ?? this.model),
    })
  }
}
