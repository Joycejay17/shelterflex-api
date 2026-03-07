/**
 * Interface for custodial wallet service operations.
 * Handles secret key decryption and transaction signing.
 */
export interface CustodialWalletService {
  /**
   * Signs a Stellar/Soroban transaction XDR.
   * 
   * @param encryptedSecretKey - The encrypted secret key (format depends on encryption implementation)
   * @param transactionXdr - The transaction XDR string to sign
   * @returns Object containing the signature and public key
   * @throws Error if decryption or signing fails
   */
  signTransaction(
    encryptedSecretKey: string,
    transactionXdr: string,
  ): Promise<{ signature: string; publicKey: string }>
}

export interface EncryptedKeyRecord {
  envelope: unknown
  keyVersion: string
  publicAddress: string
}

export interface KeyStore {
  getEncryptedKey(userId: string): Promise<EncryptedKeyRecord>
  getPublicAddress(userId: string): Promise<string>
}

export interface Decryptor {
  decrypt(envelope: unknown): Promise<Buffer>
}

export class CustodialWalletServiceImpl {
  constructor(
    private readonly store: KeyStore,
    private readonly decryptor: Decryptor,
  ) {}

  async signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }> {
    const record = await this.store.getEncryptedKey(userId)
    await this.decryptor.decrypt(record.envelope)
    return {
      signature: Buffer.from(message, 'utf8').toString('base64'),
      publicKey: record.publicAddress,
    }
  }
}
