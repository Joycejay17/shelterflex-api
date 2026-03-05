import { Router } from 'express'
import { SorobanAdapter } from '../soroban/adapter.js'

export function createBalanceRouter(adapter: SorobanAdapter) {
     const router = Router()

     router.get('/balance/:account', async (req, res) => {
          try {
               const { account } = req.params

               if (!account || account.trim() === '') {
                    return res.status(400).json({
                         error: 'Account parameter is required'
                    })
               }

               const balance = await adapter.getBalance(account)
               const config = adapter.getConfig()

               res.json({
                    account,
                    balance: balance.toString(),
                    contractId: config.contractId,
                    // Include stub indicator in response for clarity
                    adapter: 'stub',
                    network: config.networkPassphrase
               })
          } catch (error) {
               console.error('Error fetching balance:', error)
               res.status(500).json({
                    error: 'Failed to fetch balance',
                    message: error instanceof Error ? error.message : 'Unknown error'
               })
          }
     })

     // Add endpoints for credit/debit operations
     router.post('/balance/:account/credit', async (req, res) => {
          try {
               const { account } = req.params
               const { amount } = req.body

               if (!amount || typeof amount !== 'string') {
                    return res.status(400).json({
                         error: 'Amount string is required in request body'
                    })
               }

               const amountBigInt = BigInt(amount)
               await adapter.credit(account, amountBigInt)

               const newBalance = await adapter.getBalance(account)
               const config = adapter.getConfig()

               res.json({
                    account,
                    credited: amount,
                    newBalance: newBalance.toString(),
                    contractId: config.contractId,
                    adapter: 'stub'
               })
          } catch (error) {
               console.error('Error crediting account:', error)
               res.status(500).json({
                    error: 'Failed to credit account',
                    message: error instanceof Error ? error.message : 'Unknown error'
               })
          }
     })

     router.post('/balance/:account/debit', async (req, res) => {
          try {
               const { account } = req.params
               const { amount } = req.body

               if (!amount || typeof amount !== 'string') {
                    return res.status(400).json({
                         error: 'Amount string is required in request body'
                    })
               }

               const amountBigInt = BigInt(amount)
               await adapter.debit(account, amountBigInt)

               const newBalance = await adapter.getBalance(account)
               const config = adapter.getConfig()

               res.json({
                    account,
                    debited: amount,
                    newBalance: newBalance.toString(),
                    contractId: config.contractId,
                    adapter: 'stub'
               })
          } catch (error) {
               console.error('Error debiting account:', error)
               res.status(500).json({
                    error: 'Failed to debit account',
                    message: error instanceof Error ? error.message : 'Unknown error'
               })
          }
     })

     return router
}