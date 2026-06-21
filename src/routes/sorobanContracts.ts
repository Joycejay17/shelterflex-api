import { Router, type Request, type Response } from 'express'
import {
  CONTRACT_ENV_VARS,
  type ContractAddresses,
  contractAddresses,
} from '../config/contractAddresses.js'

export interface ContractIntrospectionConfig {
  networkPassphrase: string
  rpcUrl: string
  rpcLabel?: string
  addresses: ContractAddresses
}

function inferRpcLabel(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname
  } catch {
    return 'custom'
  }
}

export function buildContractIntrospection(
  config: ContractIntrospectionConfig,
) {
  return {
    network: {
      passphrase: config.networkPassphrase,
      rpcLabel: config.rpcLabel || inferRpcLabel(config.rpcUrl),
    },
    contracts: Object.fromEntries(
      Object.entries(CONTRACT_ENV_VARS).map(([name, envVar]) => {
        const address = config.addresses[name as keyof ContractAddresses]
        return [
          name,
          {
            envVar,
            configured: address !== undefined,
            address: address ?? null,
          },
        ]
      }),
    ),
  }
}

export function createSorobanContractsRouter(
  config: ContractIntrospectionConfig = {
    networkPassphrase:
      process.env.SOROBAN_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015',
    rpcUrl:
      process.env.SOROBAN_RPC_URL ??
      'https://soroban-testnet.stellar.org',
    rpcLabel: process.env.SOROBAN_NETWORK,
    addresses: contractAddresses,
  },
): Router {
  const router = Router()

  router.get('/contracts', (_req: Request, res: Response) => {
    res.json(buildContractIntrospection(config))
  })

  return router
}

