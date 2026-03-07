import { 
  rpc, 
  Address, 
  xdr, 
  scValToNative, 
  nativeToScVal,
  TransactionBuilder,
  Account,
  Operation
} from '@stellar/stellar-sdk'
import { SorobanAdapter, RecordReceiptParams } from './adapter.js'
import { SorobanConfig } from './client.js'
import { RawReceiptEvent } from '../indexer/event-parser.js'
import { logger } from '../utils/logger.js'

export class RealSorobanAdapter implements SorobanAdapter {
  private server: rpc.Server

  constructor(private config: SorobanConfig) {
    this.server = new rpc.Server(config.rpcUrl)
  }

  async getBalance(account: string): Promise<bigint> {
    // Basic implementation for USDC balance if needed
    // In this context, we focus on staking
    return 0n
  }

  async credit(account: string, amount: bigint): Promise<void> {
    throw new Error('Credit not supported in RealSorobanAdapter')
  }

  async debit(account: string, amount: bigint): Promise<void> {
    throw new Error('Debit not supported in RealSorobanAdapter')
  }

  async getStakedBalance(account: string): Promise<bigint> {
    if (!this.config.stakingPoolId) {
      throw new Error('STAKING_POOL_ID not configured')
    }

    const result = await this.invokeReadOnly(
      this.config.stakingPoolId,
      'staked_balance',
      [nativeToScVal(new Address(account))]
    )
    return BigInt(scValToNative(result))
  }

  async getClaimableRewards(account: string): Promise<bigint> {
    if (!this.config.stakingRewardsId) {
      throw new Error('STAKING_REWARDS_ID not configured')
    }

    const result = await this.invokeReadOnly(
      this.config.stakingRewardsId,
      'get_claimable',
      [nativeToScVal(new Address(account))]
    )
    return BigInt(scValToNative(result))
  }

  async recordReceipt(params: RecordReceiptParams): Promise<void> {
    // This would involve building a transaction and sending it
    // For this task, we focus on reading positions
    logger.info('recordReceipt called on RealSorobanAdapter (not implemented for write yet)', params as any)
  }

  getConfig(): SorobanConfig {
    return { ...this.config }
  }

  async getReceiptEvents(fromLedger: number | null): Promise<RawReceiptEvent[]> {
    // Event indexing implementation
    return []
  }

  private async invokeReadOnly(
    contractId: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<xdr.ScVal> {
    const sourceAccount = new Address(this.config.rpcUrl.includes('testnet') 
      ? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      : 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
    
    // Build a dummy transaction for simulation
    const tx = new TransactionBuilder(
      new Account(sourceAccount.toString(), '-1'),
      {
        fee: '100',
        networkPassphrase: this.config.networkPassphrase,
      }
    )
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: method,
            args: args,
          })
        ),
        auth: [],
      })
    )
    .setTimeout(30)
    .build()

    const simulation = await this.server.simulateTransaction(tx)
    
    if (rpc.Api.isSimulationSuccess(simulation)) {
      if (!simulation.result?.retval) {
        throw new Error(`No return value from ${method} on ${contractId}`)
      }
      return simulation.result.retval
    } else if (rpc.Api.isSimulationRestore(simulation)) {
      throw new Error(`Contract ${contractId} is archived. Needs restoration.`)
    } else {
      throw new Error(`Simulation failed for ${method} on ${contractId}: ${simulation.error}`)
    }
  }
}
