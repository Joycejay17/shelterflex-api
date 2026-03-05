import { Keypair, Transaction } from "@stellar/stellar-sdk"
import { CustodialWalletService } from "./CustodialWalletService.js"

/**
 * Implementation of CustodialWalletService using Stellar SDK.
 * 
 * Security notes:
 * - Decrypted secret keys are only held in memory during signing
 * - Keys are never logged or exposed outside the service boundary
 * - All signing operations are audited (without secrets)
 */
export class CustodialWalletServiceImpl implements CustodialWalletService {
  private readonly logger: (message: string, metadata?: Record<string, unknown>) => void
  private readonly networkPassphrase: string

  constructor(
    networkPassphrase: string,
    logger?: (message: string, metadata?: Record<string, unknown>) => void,
  ) {
    this.networkPassphrase = networkPassphrase
    this.logger = logger ?? ((msg, meta) => {
      console.log(`[CustodialWalletService] ${msg}`, meta ? JSON.stringify(meta) : "")
    })
  }

  /**
   * Decrypts a secret key from its encrypted format.
   * 
   * For now, this assumes the secret key is provided in Stellar secret key format (S...).
   * In production, this should decrypt from a secure storage format.
   * 
   * @param encryptedSecretKey - The encrypted/encoded secret key
   * @returns The decrypted secret key string
   * @throws Error if decryption fails or key format is invalid
   */
  private decryptSecretKey(encryptedSecretKey: string): string {
    // TODO: Implement proper decryption based on your encryption scheme
    // For now, we assume the key is already in Stellar secret key format
    // In production, you would decrypt from your secure storage format here
    
    // Validate that it looks like a Stellar secret key (starts with 'S')
    if (!encryptedSecretKey.startsWith("S")) {
      throw new Error("Invalid secret key format: must be a Stellar secret key (starts with 'S')")
    }

    // In a real implementation, you would decrypt here:
    // const decrypted = yourDecryptionFunction(encryptedSecretKey, decryptionKey)
    // For now, we assume it's already decrypted or needs minimal processing
    
    return encryptedSecretKey
  }

  /**
   * Signs a Stellar/Soroban transaction XDR.
   * 
   * @param encryptedSecretKey - The encrypted secret key
   * @param transactionXdr - The transaction XDR string to sign
   * @returns Object containing the signature and public key
   * @throws Error if decryption, parsing, or signing fails
   */
  async signTransaction(
    encryptedSecretKey: string,
    transactionXdr: string,
  ): Promise<{ signature: string; publicKey: string }> {
    // Audit log: signing invoked (no secrets)
    this.logger("Transaction signing invoked", {
      transactionXdrLength: transactionXdr.length,
      timestamp: new Date().toISOString(),
    })

    let keypair: Keypair | null = null
    let secretKey: string | null = null

    try {
      // Decrypt the secret key
      secretKey = this.decryptSecretKey(encryptedSecretKey)

      // Derive Keypair from secret key
      keypair = Keypair.fromSecret(secretKey)

      // Get the public key before signing (for return value)
      const publicKey = keypair.publicKey()

      // Clear the secret key from memory as soon as possible
      secretKey = null

      // Parse the transaction XDR
      // Transaction.fromXDR handles both regular and Soroban transactions
      const transaction = Transaction.fromXDR(transactionXdr, this.networkPassphrase)

      // Sign the transaction
      transaction.sign(keypair)

      // Get the signature from the transaction
      // The signature is added to the transaction's signature list
      const signatures = transaction.signatures
      if (!signatures || signatures.length === 0) {
        throw new Error("Transaction signing failed: no signatures generated")
      }

      // Extract the signature (last signature is the one we just added)
      const lastSignature = signatures[signatures.length - 1]
      const signatureBase64 = lastSignature.signature().toString("base64")

      // Audit log: signing completed successfully
      this.logger("Transaction signing completed", {
        publicKey,
        signatureLength: signatureBase64.length,
        timestamp: new Date().toISOString(),
      })

      return {
        signature: signatureBase64,
        publicKey,
      }
    } catch (error) {
      // Audit log: signing failed
      this.logger("Transaction signing failed", {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })

      // Clear any remaining secret key data
      secretKey = null
      keypair = null

      throw error
    }
  }
}
