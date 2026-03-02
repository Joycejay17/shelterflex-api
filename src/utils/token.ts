import { env } from '../schemas/env.js'

/**
 * Returns the USDC token contract address for the current environment.
 * 
 * @throws {Error} If USDC_TOKEN_ADDRESS is not configured in non-development environments
 * @returns {string} The USDC token contract address
 */
export function getUsdcTokenAddress(): string {
  const address = env.USDC_TOKEN_ADDRESS
  
  if (!address) {
    if (env.NODE_ENV === 'development') {
      // In development, we can use a mock address for testing
      return '0x0000000000000000000000000000000000000000'
    }
    
    throw new Error(
      `USDC_TOKEN_ADDRESS is required in ${env.NODE_ENV} environment. ` +
      `Please set the USDC_TOKEN_ADDRESS environment variable for the ${env.SOROBAN_NETWORK} network.`
    )
  }
  
  return address
}

/**
 * Returns the current Soroban network environment.
 * 
 * @returns {'local' | 'testnet' | 'mainnet'} The current network
 */
export function getSorobanNetwork(): 'local' | 'testnet' | 'mainnet' {
  return env.SOROBAN_NETWORK
}
