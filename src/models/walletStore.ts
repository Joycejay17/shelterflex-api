import { Wallet, CreateWalletInput, WalletStore } from '../models/wallet.js'

/**
 * In-memory implementation of WalletStore for MVP development
 * In production, this should be replaced with a database implementation
 */
export class InMemoryWalletStore implements WalletStore {
  private wallets: Map<string, Wallet> = new Map()

  async create(input: CreateWalletInput): Promise<Wallet> {
    // Check if wallet already exists for this user
    if (this.wallets.has(input.userId)) {
      throw new Error(`Wallet already exists for user ${input.userId}`)
    }

    const wallet: Wallet = {
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    this.wallets.set(input.userId, wallet)
    return wallet
  }

  async getByUserId(userId: string): Promise<Wallet | null> {
    return this.wallets.get(userId) || null
  }

  async getPublicAddress(userId: string): Promise<string> {
    const wallet = this.wallets.get(userId)
    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId}`)
    }
    return wallet.publicKey
  }

  async getEncryptedKey(userId: string): Promise<{ cipherText: string; keyId: string } | null> {
    const wallet = this.wallets.get(userId)
    if (!wallet) {
      return null
    }
    return {
      cipherText: wallet.encryptedSecretKey,
      keyId: wallet.keyId,
    }
  }

  async updateEncryption(
    userId: string,
    newEncryptedSecretKey: string,
    newKeyId: string
  ): Promise<Wallet> {
    const wallet = this.wallets.get(userId)
    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId}`)
    }

    const updatedWallet: Wallet = {
      ...wallet,
      encryptedSecretKey: newEncryptedSecretKey,
      keyId: newKeyId,
      updatedAt: new Date(),
    }

    this.wallets.set(userId, updatedWallet)
    return updatedWallet
  }

  // Helper method for testing/cleanup
  clear(): void {
    this.wallets.clear()
  }

  // Helper method to get all wallets (for testing)
  getAll(): Wallet[] {
    return Array.from(this.wallets.values())
  }
}
