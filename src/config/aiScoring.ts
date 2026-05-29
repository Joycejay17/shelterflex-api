/**
 * AI tenant risk scoring configuration (env-driven).
 */

export type AiScoringProviderName = 'claude' | 'stub'

export interface AiScoringConfig {
  enabled: boolean
  provider: AiScoringProviderName
  model: string
  cacheTtlMs: number
  anthropicApiKey?: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

export function getAiScoringConfig(): AiScoringConfig {
  const providerRaw = (process.env.AI_SCORING_PROVIDER ?? 'stub').toLowerCase()
  const provider: AiScoringProviderName =
    providerRaw === 'claude' ? 'claude' : 'stub'

  return {
    enabled: readBool('AI_SCORING_ENABLED', false),
    provider,
    model: process.env.AI_SCORING_MODEL ?? DEFAULT_MODEL,
    cacheTtlMs: CACHE_TTL_MS,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  }
}
