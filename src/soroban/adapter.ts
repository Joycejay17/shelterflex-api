import { SorobanConfig } from './client.js'

export interface SorobanAdapter {
     getBalance(account: string): Promise<bigint>
     credit(account: string, amount: bigint): Promise<void>
     debit(account: string, amount: bigint): Promise<void>
     getConfig(): SorobanConfig
}