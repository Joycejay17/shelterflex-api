/**
 * E-Signature Service
 * Abstract interface with stub provider for local development
 */

import { randomUUID } from 'node:crypto'

export interface Signer {
  id: string
  name: string
  email: string
  role: 'tenant' | 'landlord'
}

export interface SigningRequest {
  requestId: string
  documentKey: string
  signers: Signer[]
  status: 'pending' | 'completed' | 'expired'
  createdAt: Date
}

export interface SigningUrl {
  url: string
  expiresAt: Date
}

export interface ESignatureProvider {
  createSigningRequest(documentKey: string, signers: Signer[]): Promise<SigningRequest>
  getSigningUrl(requestId: string, signerId: string): Promise<SigningUrl>
  handleWebhook(payload: unknown): Promise<{ requestId: string; signerId: string; signed: boolean }>
  verifySignature(requestId: string, signerId: string): Promise<boolean>
}

/**
 * Stub e-signature provider for local development
 * Uses in-memory tokens instead of real e-signature service
 */
export class StubESignatureProvider implements ESignatureProvider {
  private requests = new Map<string, SigningRequest & { tokens: Map<string, string> }>()

  async createSigningRequest(documentKey: string, signers: Signer[]): Promise<SigningRequest> {
    const requestId = randomUUID()
    const tokens = new Map<string, string>()

    for (const signer of signers) {
      tokens.set(signer.id, randomUUID())
    }

    const request: SigningRequest & { tokens: Map<string, string> } = {
      requestId,
      documentKey,
      signers,
      status: 'pending',
      createdAt: new Date(),
      tokens,
    }

    this.requests.set(requestId, request)
    return { ...request, tokens: undefined as any }
  }

  async getSigningUrl(requestId: string, signerId: string): Promise<SigningUrl> {
    const request = this.requests.get(requestId)
    if (!request) {
      throw new Error(`Signing request ${requestId} not found`)
    }

    const token = request.tokens.get(signerId)
    if (!token) {
      throw new Error(`Signer ${signerId} not found in request ${requestId}`)
    }

    // In stub mode, return a URL that points to the stub webhook
    return {
      url: `/api/webhooks/esignature/stub?token=${token}&signer=${signerId}&requestId=${requestId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    }
  }

  async handleWebhook(payload: unknown): Promise<{ requestId: string; signerId: string; signed: boolean }> {
    const { token, signer, requestId } = payload as {
      token: string
      signer: string
      requestId: string
    }

    const request = this.requests.get(requestId)
    if (!request) {
      throw new Error(`Signing request ${requestId} not found`)
    }

    const expectedToken = request.tokens.get(signer)
    if (!expectedToken || expectedToken !== token) {
      throw new Error('Invalid signing token')
    }

    return { requestId, signerId: signer, signed: true }
  }

  async verifySignature(requestId: string, signerId: string): Promise<boolean> {
    const request = this.requests.get(requestId)
    if (!request) return false

    return request.tokens.has(signerId)
  }
}

/**
 * Create e-signature provider based on environment config
 */
export function createESignatureProvider(): ESignatureProvider {
  const provider = process.env.ESIGN_PROVIDER || 'stub'

  switch (provider) {
    case 'stub':
      return new StubESignatureProvider()
    default:
      return new StubESignatureProvider()
  }
}
