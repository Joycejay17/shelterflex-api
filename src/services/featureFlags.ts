import { flagDefaults, type FlagName } from '../config/featureFlags.js'

/**
 * Returns whether a feature flag is enabled.
 *
 * Resolution order:
 *  1. Environment variable FEATURE_FLAG_<FLAG_NAME> (e.g. FEATURE_FLAG_STAKING_ENABLED=true)
 *  2. The default value from config/featureFlags.ts
 *
 * The optional `context` parameter is reserved for future user-targeting overrides
 * (e.g. per-user DB rows). For now it is unused — all flags are config-backed and
 * therefore synchronous.
 */
export function isEnabled(
  flag: FlagName,
  _context?: { userId?: string; role?: string },
): boolean {
  const envKey = `FEATURE_FLAG_${flag}`
  const envOverride = process.env[envKey]
  if (envOverride !== undefined) {
    return envOverride === 'true' || envOverride === '1'
  }
  return flagDefaults[flag]
}

/** Returns a snapshot of every flag after env overrides are applied. */
export function getAllFlags(): Record<FlagName, boolean> {
  const result = {} as Record<FlagName, boolean>
  for (const flag of Object.keys(flagDefaults) as FlagName[]) {
    result[flag] = isEnabled(flag)
  }
  return result
}
