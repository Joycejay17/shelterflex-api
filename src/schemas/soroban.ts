import { z } from 'zod'

/**
 * Body schema for POST /soroban/simulate.
 *
 * Validates that a caller supplies a well-formed contract invocation before
 * the backend forwards it to the Soroban RPC node, so we catch typos and
 * missing fields early with friendly messages instead of opaque RPC errors.
 */
export const simulateContractSchema = z.object({
  /** Stellar contract address (C… or G… strkey, 56 chars). */
  contractId: z
    .string({ required_error: 'contractId is required' })
    .length(56, 'contractId must be a 56-character Stellar strkey'),

  /** Name of the contract method to invoke. */
  method: z
    .string({ required_error: 'method is required' })
    .min(1, 'method cannot be empty'),

  /**
   * Positional arguments passed to the contract method.
   * Each element will be forwarded as-is to the Soroban RPC.
   * Defaults to an empty array when omitted.
   */
  args: z.array(z.unknown()).default([]),
})

export type SimulateContractInput = z.infer<typeof simulateContractSchema>
