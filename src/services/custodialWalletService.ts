/**
 * Interface for custodial wallet service operations.
 * Handles secret key decryption and transaction signing.
 */
import { Keypair } from '@stellar/stellar-sdk'
import { type EncryptedKeyEnvelope } from '../utils/encryption.js'

export interface CustodialWalletService {
  signTransaction(
    encryptedSecretKey: string,
    transactionXdr: string,
  ): Promise<{ signature: string; publicKey: string }>
}

export interface EncryptedKeyRecord {
  envelope: EncryptedKeyEnvelope
  keyVersion: string
  publicAddress: string
}

export interface KeyStore {
  getEncryptedKey(userId: string): Promise<EncryptedKeyRecord>
  getPublicAddress(userId: string): Promise<string>
}

export interface Decryptor {
  decrypt(envelope: EncryptedKeyEnvelope): Promise<Buffer>
}

export class CustodialWalletServiceImpl {
  constructor(private store: KeyStore, private decryptor: Decryptor) {}

  async signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }> {
    const record = await this.store.getEncryptedKey(userId)
    const secret = await this.decryptor.decrypt(record.envelope)
    const seed = await import('node:crypto').then((c) =>
      c.createHash('sha256').update(secret).digest(),
    )
    const keypair = Keypair.fromRawEd25519Seed(seed)
    const signature = keypair.sign(Buffer.from(message)).toString('base64')
    return { signature, publicKey: record.publicAddress }
  }
}
