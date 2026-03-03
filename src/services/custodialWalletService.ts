import { createHmac } from 'node:crypto'
import { type EncryptedKeyEnvelope, decrypt as aesDecrypt } from '../utils/encryption.js'

export interface EncryptedKeyRecord {
  /** Encrypted key envelope containing ciphertext, IV, and auth tag */
  envelope: EncryptedKeyEnvelope
  /** Key version identifier for rotation tracking */
  keyVersion: string
  /** Public address associated with this encrypted key */
  publicAddress: string
}

export interface KeyStore {
  getEncryptedKey(userId: string): Promise<EncryptedKeyRecord>
  getPublicAddress(userId: string): Promise<string>
}

export interface Decryptor {
  decrypt(envelope: EncryptedKeyEnvelope): Promise<Buffer>
}

export interface CustodialWalletService {
  getAddress(userId: string): Promise<string>
  signSorobanTx(
    userId: string,
    xdrOrPayload: unknown,
  ): Promise<{ signature: string; publicKey: string }>
  signMessage(
    userId: string,
    message: string,
  ): Promise<{ signature: string; publicKey: string }>
}

export class CustodialWalletServiceImpl implements CustodialWalletService {
  constructor(private store: KeyStore, private decryptor: Decryptor) {}

  async getAddress(userId: string): Promise<string> {
    return this.store.getPublicAddress(userId)
  }

  async signMessage(
    userId: string,
    message: string,
  ): Promise<{ signature: string; publicKey: string }> {
    const { envelope, publicAddress } = await this.store.getEncryptedKey(userId)
    const privateMaterial = await this.decryptor.decrypt(envelope)
    const signature = this.hmacSha256(privateMaterial, Buffer.from(message))
    return { signature, publicKey: publicAddress }
  }

  async signSorobanTx(
    userId: string,
    xdrOrPayload: unknown,
  ): Promise<{ signature: string; publicKey: string }> {
    const { envelope, publicAddress } = await this.store.getEncryptedKey(userId)
    const privateMaterial = await this.decryptor.decrypt(envelope)
    const payloadBytes = this.normalizePayload(xdrOrPayload)
    const signature = this.hmacSha256(privateMaterial, payloadBytes)
    return { signature, publicKey: publicAddress }
  }

  private normalizePayload(xdrOrPayload: unknown): Buffer {
    if (xdrOrPayload == null) return Buffer.alloc(0)
    if (typeof xdrOrPayload === 'string') return Buffer.from(xdrOrPayload)
    if (xdrOrPayload instanceof Uint8Array) return Buffer.from(xdrOrPayload)
    return Buffer.from(JSON.stringify(xdrOrPayload))
  }

  private hmacSha256(secret: Buffer, data: Buffer): string {
    const h = createHmac('sha256', secret)
    h.update(data)
    return h.digest('base64')
  }
}

/**
 * AES-256-GCM Decryptor implementation
 * Uses the encryption utility for secure decryption
 */
export class AesGcmDecryptor implements Decryptor {
  constructor(private masterKey: string) {}

  async decrypt(envelope: EncryptedKeyEnvelope): Promise<Buffer> {
    return aesDecrypt(envelope, this.masterKey)
  }
}

/**
 * @deprecated Use AesGcmDecryptor with AES-256-GCM instead. This class is kept for backward compatibility only.
 */
export class InMemoryDecryptor implements Decryptor {
  constructor(private keyMap: Map<string, Buffer>) {}
  async decrypt(_envelope: EncryptedKeyEnvelope): Promise<Buffer> {
    throw new Error('InMemoryDecryptor is deprecated. Use AesGcmDecryptor with AES-256-GCM encryption.')
  }
}

/**
 * @deprecated Use encrypt() from '../utils/encryption.js' instead. This function is insecure (XOR-based).
 */
export function createEncryptedKeyRecord(_plain: Buffer, _keyId: string): never {
  throw new Error('createEncryptedKeyRecord is deprecated. Use encrypt() from utils/encryption.js with AES-256-GCM.')
}
