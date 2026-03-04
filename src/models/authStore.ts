import { randomUUID } from 'node:crypto'

export type UserRole = 'tenant' | 'landlord' | 'agent'

export interface User {
  id: string
  email: string
  createdAt: Date
  name: string
  role: UserRole
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
}

class UserStore {
  private usersByEmail: Map<string, User> = new Map()

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

  clear(): void {
    this.usersByEmail.clear()
  }
}

class OtpChallengeStore {
  private challengesByEmail: Map<string, OtpChallenge> = new Map()

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

class SessionStore {
  private sessionsByToken: Map<string, Session> = new Map()

  create(email: string, token: string): Session {
    const session: Session = {
      token,
      email,
      createdAt: new Date(),
    }

    this.sessionsByToken.set(token, session)
    return session
  }

  getByToken(token: string): Session | undefined {
    return this.sessionsByToken.get(token)
  }

  deleteByToken(token: string): void {
    this.sessionsByToken.delete(token)
  }

  clear(): void {
    this.sessionsByToken.clear()
  }
}

export const userStore = new UserStore()
export const otpChallengeStore = new OtpChallengeStore()
export const sessionStore = new SessionStore()
