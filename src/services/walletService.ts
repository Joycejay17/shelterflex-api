import { Keypair } from '@stellar/stellar-sdk'
import { createHmac, randomBytes, scrypt } from 'node:crypto'
import { WalletStore } from '../models/wallet.js'

export interface EncryptionService {
  encrypt(data: Buffer, keyId: string): Promise<{ cipherText: Buffer; keyId: string }>
  decrypt(cipherText: Buffer, keyId: string): Promise<Buffer>
  getCurrentKeyId(): string
}

export interface WalletService {
  createWalletForUser(userId: string): Promise<{ publicKey: string }>
  getPublicAddress(userId: string): Promise<string>
  signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }>
  signSorobanTransaction(userId: string, xdr: string): Promise<{ signature: string; publicKey: string }>
}

export class WalletServiceImpl implements WalletService {
  constructor(
    private walletStore: WalletStore,
    private encryptionService: EncryptionService
  ) {}

  async createWalletForUser(userId: string): Promise<{ publicKey: string }> {
    // Check if wallet already exists
    const existing = await this.walletStore.getByUserId(userId)
    if (existing) {
      return { publicKey: existing.publicKey }
    }

    // Generate new Stellar keypair
    const keypair = Keypair.random()
    const secretKey = keypair.rawSecretKey()
    const publicKey = keypair.publicKey()

    // Encrypt the secret key
    const keyId = this.encryptionService.getCurrentKeyId()
    const { cipherText } = await this.encryptionService.encrypt(secretKey, keyId)

    // Store the wallet
    await this.walletStore.create({
      userId,
      publicKey: publicKey,
      encryptedSecretKey: cipherText.toString('base64'),
      keyId,
    })

    return { publicKey }
  }

  async getPublicAddress(userId: string): Promise<string> {
    return this.walletStore.getPublicAddress(userId)
  }

  async signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }> {
    const encryptedKey = await this.walletStore.getEncryptedKey(userId)
    if (!encryptedKey) {
      throw new Error(`No wallet found for user ${userId}`)
    }

    const secretKey = await this.encryptionService.decrypt(
      Buffer.from(encryptedKey.cipherText, 'base64'),
      encryptedKey.keyId
    )

    const keypair = Keypair.fromRawEd25519Seed(secretKey)
    const signature = keypair.sign(Buffer.from(message)).toString('base64')

    return {
      signature,
      publicKey: keypair.publicKey(),
    }
  }

  async signSorobanTransaction(userId: string, xdr: string): Promise<{ signature: string; publicKey: string }> {
    const encryptedKey = await this.walletStore.getEncryptedKey(userId)
    if (!encryptedKey) {
      throw new Error(`No wallet found for user ${userId}`)
    }

    const secretKey = await this.encryptionService.decrypt(
      Buffer.from(encryptedKey.cipherText, 'base64'),
      encryptedKey.keyId
    )

    const keypair = Keypair.fromRawEd25519Seed(secretKey)
    const signature = keypair.sign(Buffer.from(xdr, 'base64')).toString('base64')

    return {
      signature,
      publicKey: keypair.publicKey(),
    }
  }
}

/**
 * Environment-based encryption service for MVP
 * Uses scrypt with environment variable to derive encryption keys
 */
export class EnvironmentEncryptionService implements EncryptionService {
  private keyCache: Map<string, Buffer> = new Map()

  constructor(private encryptionKeyBase: string) {
    if (!encryptionKeyBase || encryptionKeyBase.length < 32) {
      throw new Error('Encryption key must be at least 32 characters')
    }
  }

  getCurrentKeyId(): string {
    // For MVP, we use a single key ID
    // In production, this should support key rotation
    return 'env-key-1'
  }

  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(this.encryptionKeyBase, salt, 32, (err, derivedKey) => {
        if (err) reject(err)
        else resolve(derivedKey)
      })
    })
  }

  async encrypt(data: Buffer, keyId: string): Promise<{ cipherText: Buffer; keyId: string }> {
    const salt = randomBytes(16)
    const iv = randomBytes(16)
    const key = await this.deriveKey(salt)
    
    // Simple XOR encryption for MVP (replace with AES in production)
    const encrypted = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) {
      encrypted[i] = data[i] ^ key[i % key.length] ^ iv[i % iv.length]
    }

    // Combine salt + iv + encrypted data
    const cipherText = Buffer.concat([salt, iv, encrypted])
    
    return { cipherText, keyId }
  }

  async decrypt(cipherText: Buffer, keyId: string): Promise<Buffer> {
    if (cipherText.length < 32) {
      throw new Error('Invalid ciphertext: too short')
    }

    const salt = cipherText.subarray(0, 16)
    const iv = cipherText.subarray(16, 32)
    const encrypted = cipherText.subarray(32)
    
    const key = await this.deriveKey(salt)
    
    // Reverse the XOR encryption
    const decrypted = Buffer.alloc(encrypted.length)
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ key[i % key.length] ^ iv[i % iv.length]
    }

    return decrypted
  }
}
