import { randomUUID } from 'node:crypto'

export type UserRole = 'tenant' | 'landlord' | 'agent'

export interface User {
  id: string
  email: string
  createdAt: Date
  name: string
  role: UserRole
  walletAddress?: string
}

export interface OtpChallenge {
  email: string
  otpHash: string
  salt: string
  expiresAt: Date
  attempts: number
}

export interface Session {
  token: string
  email: string
  createdAt: Date
  expiresAt: Date
  lastSeenAt: Date
  revokedAt?: Date
  userAgent?: string
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface WalletChallenge {
  address: string
  challengeXdr: string
  nonce: string
  expiresAt: Date
  attempts: number
}

class UserStore {
  private readonly usersByEmail: Map<string, User> = new Map()

  getByEmail(email: string): User | undefined {
    return this.usersByEmail.get(email)
  }

  getOrCreateByEmail(email: string): User {
    const existing = this.usersByEmail.get(email)
    if (existing) return existing

    const now = new Date()
    const user: User = {
      id: randomUUID(),
      email,
      createdAt: now,
      name: email.split('@')[0] ?? email,
      role: 'tenant',
    }

    this.usersByEmail.set(email, user)
    return user
  }

  getByWalletAddress(address: string): User | undefined {
    for (const user of this.usersByEmail.values()) {
      if (user.walletAddress === address.toLowerCase()) {
        return user
      }
    }
    return undefined
  }

  linkWalletToUser(email: string, walletAddress: string): User {
    const user = this.getOrCreateByEmail(email)
    user.walletAddress = walletAddress.toLowerCase()
    this.usersByEmail.set(email, user)
    return user
  }

  clear(): void {
    this.usersByEmail.clear()
  }
}

class OtpChallengeStore {
  private readonly challengesByEmail: Map<string, OtpChallenge> = new Map()

  set(challenge: OtpChallenge): void {
    this.challengesByEmail.set(challenge.email, challenge)
  }

  getByEmail(email: string): OtpChallenge | undefined {
    return this.challengesByEmail.get(email)
  }

  deleteByEmail(email: string): void {
    this.challengesByEmail.delete(email)
  }

  clear(): void {
    this.challengesByEmail.clear()
  }
}

class WalletChallengeStore {
  private readonly challengesByAddress: Map<string, WalletChallenge> = new Map()

  set(challenge: WalletChallenge): void {
    this.challengesByAddress.set(challenge.address.toLowerCase(), challenge)
  }

  getByAddress(address: string): WalletChallenge | undefined {
    return this.challengesByAddress.get(address.toLowerCase())
  }

  deleteByAddress(address: string): void {
    this.challengesByAddress.delete(address.toLowerCase())
  }

  clear(): void {
    this.challengesByAddress.clear()
  }
}

class SessionStore {
  private readonly sessionsByToken: Map<string, Session> = new Map()

  create(
    email: string,
    token: string,
    options?: { ttlMs?: number; userAgent?: string },
  ): Session {
    const now = new Date()
    const session: Session = {
      token,
      email,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + (options?.ttlMs ?? SESSION_TTL_MS)),
      ...(options?.userAgent ? { userAgent: options.userAgent } : {}),
    }

    this.sessionsByToken.set(token, session)
    return session
  }

  getByToken(token: string): Session | undefined {
    const session = this.sessionsByToken.get(token)
    if (!session) return undefined
    if (session.revokedAt) return undefined
    if (new Date() > session.expiresAt) return undefined
    // Touch lastSeenAt
    session.lastSeenAt = new Date()
    return session
  }

  /** Returns the raw session record even if expired/revoked — for internal use only. */
  getRawByToken(token: string): Session | undefined {
    return this.sessionsByToken.get(token)
  }

  deleteByToken(token: string): void {
    this.sessionsByToken.delete(token)
  }

  revokeByToken(token: string): void {
    const session = this.sessionsByToken.get(token)
    if (session) {
      session.revokedAt = new Date()
    }
  }

  revokeAllByEmail(email: string): number {
    let count = 0
    for (const session of this.sessionsByToken.values()) {
      if (session.email === email && !session.revokedAt) {
        session.revokedAt = new Date()
        count++
      }
    }
    return count
  }

  getActiveSessionsByEmail(email: string): Session[] {
    const now = new Date()
    return Array.from(this.sessionsByToken.values()).filter(
      (s) => s.email === email && !s.revokedAt && now <= s.expiresAt,
    )
  }

  clear(): void {
    this.sessionsByToken.clear()
  }
}

export const userStore = new UserStore()
export const otpChallengeStore = new OtpChallengeStore()
export const walletChallengeStore = new WalletChallengeStore()
export const sessionStore = new SessionStore()
