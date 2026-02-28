import { SorobanAdapter } from './adapter.js'
import { SorobanConfig } from './client.js'

// In-memory store for stub balances
const stubBalances = new Map<string, bigint>()

export class StubSorobanAdapter implements SorobanAdapter {
     private config: SorobanConfig

     constructor(config: SorobanConfig) {
          this.config = config
          console.log('🔧 Using StubSorobanAdapter - no real Soroban calls will be made')
          console.log(`📝 Configured with RPC: ${config.rpcUrl}`)
          if (config.contractId) {
               console.log(`📝 Contract ID: ${config.contractId}`)
          }
     }

     async getBalance(account: string): Promise<bigint> {
          // Return deterministic balance based on account address
          // This creates predictable but unique balances for testing
          if (!stubBalances.has(account)) {
               // Generate a deterministic "balance" based on the account string
               const hash = this.simpleHash(account)
               // Make it a reasonable token amount (between 1000 and 10000)
               const balance = BigInt(1000 + (hash % 9000))
               stubBalances.set(account, balance)
          }

          const balance = stubBalances.get(account)!
          console.log(`[Stub] getBalance(${account}) -> ${balance.toString()}`)
          return balance
     }

     async credit(account: string, amount: bigint): Promise<void> {
          const currentBalance = await this.getBalance(account)
          const newBalance = currentBalance + amount
          stubBalances.set(account, newBalance)
          console.log(`[Stub] credit(${account}, ${amount.toString()}) -> new balance: ${newBalance.toString()}`)
     }

     async debit(account: string, amount: bigint): Promise<void> {
          const currentBalance = await this.getBalance(account)
          if (currentBalance < amount) {
               throw new Error(`Insufficient balance: ${currentBalance.toString()} < ${amount.toString()}`)
          }
          const newBalance = currentBalance - amount
          stubBalances.set(account, newBalance)
          console.log(`[Stub] debit(${account}, ${amount.toString()}) -> new balance: ${newBalance.toString()}`)
     }

     getConfig(): SorobanConfig {
          return { ...this.config }
     }

     // Simple string hash function for deterministic "randomness"
     private simpleHash(str: string): number {
          let hash = 0
          for (let i = 0; i < str.length; i++) {
               const char = str.charCodeAt(i)
               hash = ((hash << 5) - hash) + char
               hash = hash & hash // Convert to 32-bit integer
          }
          return Math.abs(hash)
     }
}