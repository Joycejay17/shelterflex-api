/**
 * Blocks tenants from submitting new applications (existing deals unaffected).
 */

class UserApplicationBlockStore {
  private blocked = new Map<string, { reason: string; blockedAt: Date }>()

  block(userId: string, reason: string): void {
    this.blocked.set(userId, { reason, blockedAt: new Date() })
  }

  unblock(userId: string): void {
    this.blocked.delete(userId)
  }

  isBlocked(userId: string): boolean {
    return this.blocked.has(userId)
  }

  getBlock(userId: string): { reason: string; blockedAt: Date } | undefined {
    return this.blocked.get(userId)
  }

  clear(): void {
    this.blocked.clear()
  }
}

export const userApplicationBlockStore = new UserApplicationBlockStore()

export function isNewApplicationsBlocked(userId: string): boolean {
  return userApplicationBlockStore.isBlocked(userId)
}
