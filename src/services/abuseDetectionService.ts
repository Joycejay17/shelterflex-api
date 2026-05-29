import { randomUUID } from 'crypto'
import { getRedisClient } from '../utils/redis.js'

export interface AbuseEvent {
  id: string
  target: string // IP address or user ID
  type: 'credential_stuffing' | 'scraping' | 'deal_spam'
  timestamp: Date
  expiresAt: Date
}

// In-memory fallback stores for tracking and tests
const failedAuthStore = new Map<string, { count: number; expiresAt: number }>()
const searchHitsStore = new Map<string, { count: number; expiresAt: number }>()
const dealSpamStore = new Map<string, { count: number; expiresAt: number }>()

export const abuseEvents: AbuseEvent[] = []

export const abuseEventStore = {
  add(event: Omit<AbuseEvent, 'id' | 'timestamp'>): AbuseEvent {
    const fullEvent: AbuseEvent = {
      id: randomUUID(),
      target: event.target,
      type: event.type,
      timestamp: new Date(),
      expiresAt: event.expiresAt,
    }
    abuseEvents.push(fullEvent)
    return fullEvent
  },

  getAll(): AbuseEvent[] {
    const now = new Date()
    return abuseEvents.filter((e) => e.expiresAt > now)
  },

  getPaginated(page: number, pageSize: number) {
    const active = this.getAll().sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    const total = active.length
    const start = (page - 1) * pageSize
    const data = active.slice(start, start + pageSize)
    return { data, total }
  },

  clear() {
    abuseEvents.length = 0
    failedAuthStore.clear()
    searchHitsStore.clear()
    dealSpamStore.clear()
  }
}

export async function detectCredentialStuffing(ip: string): Promise<boolean> {
  const now = Date.now()
  const windowMs = 5 * 60 * 1000 // 5 minutes
  const blockMs = 60 * 60 * 1000 // 1 hour

  const record = failedAuthStore.get(ip)
  let count = 1
  if (record && record.expiresAt > now) {
    count = record.count + 1
    record.count = count
  } else {
    failedAuthStore.set(ip, { count: 1, expiresAt: now + windowMs })
  }

  if (count > 10) {
    const expiresAt = new Date(now + blockMs)
    abuseEventStore.add({
      target: ip,
      type: 'credential_stuffing',
      expiresAt,
    })
    return true
  }

  try {
    const redis = getRedisClient()
    const key = `failed_auth:${ip}`
    const val = await redis.get(key)
    const current = val ? parseInt(val, 10) + 1 : 1
    await redis.set(key, current.toString(), 'EX' as any, 300)

    if (current > 10) {
      await redis.set(`blocked_ip:${ip}`, 'true', 'EX' as any, 3600)
      return true
    }
  } catch (err) {
    // Fail silently
  }

  return false
}

export async function detectScrapingPattern(ip: string): Promise<boolean> {
  const now = Date.now()
  const windowMs = 60 * 1000 // 60 seconds
  const blockMs = 60 * 60 * 1000 // 1 hour

  const record = searchHitsStore.get(ip)
  let count = 1
  if (record && record.expiresAt > now) {
    count = record.count + 1
    record.count = count
  } else {
    searchHitsStore.set(ip, { count: 1, expiresAt: now + windowMs })
  }

  if (count > 180) { // 3x search limit (60 req/min)
    const expiresAt = new Date(now + blockMs)
    abuseEventStore.add({
      target: ip,
      type: 'scraping',
      expiresAt,
    })
    return true
  }

  try {
    const redis = getRedisClient()
    const key = `search_hits:${ip}`
    const val = await redis.get(key)
    const current = val ? parseInt(val, 10) + 1 : 1
    await redis.set(key, current.toString(), 'EX' as any, 60)

    if (current > 180) {
      await redis.set(`blocked_ip:${ip}`, 'true', 'EX' as any, 3600)
      return true
    }
  } catch (err) {
    // Fail silently
  }

  return false
}

export async function detectDuplicateDealSpam(userId: string, listingId: string): Promise<boolean> {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000 // 1 hour
  const blockMs = 60 * 60 * 1000 // 1 hour

  const key = `${userId}:${listingId}`
  const record = dealSpamStore.get(key)
  let count = 1
  if (record && record.expiresAt > now) {
    count = record.count + 1
    record.count = count
  } else {
    dealSpamStore.set(key, { count: 1, expiresAt: now + windowMs })
  }

  if (count > 5) {
    const expiresAt = new Date(now + blockMs)
    abuseEventStore.add({
      target: userId,
      type: 'deal_spam',
      expiresAt,
    })
    return true
  }

  try {
    const redis = getRedisClient()
    const redisKey = `deal_spam:${userId}:${listingId}`
    const val = await redis.get(redisKey)
    const current = val ? parseInt(val, 10) + 1 : 1
    await redis.set(redisKey, current.toString(), 'EX' as any, 3600)

    if (current > 5) {
      await redis.set(`blocked_user:${userId}`, 'true', 'EX' as any, 3600)
      return true
    }
  } catch (err) {
    // Fail silently
  }

  return false
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  const now = new Date()
  const hasInMemoryBlock = abuseEvents.some(
    (e) => e.target === ip && e.expiresAt > now && (e.type === 'credential_stuffing' || e.type === 'scraping')
  )
  if (hasInMemoryBlock) return true

  try {
    const redis = getRedisClient()
    const blocked = await redis.get(`blocked_ip:${ip}`)
    if (blocked === 'true') return true
  } catch (err) {
    // Fail silently
  }

  return false
}

export async function isUserBlocked(userId: string): Promise<boolean> {
  const now = new Date()
  const hasInMemoryBlock = abuseEvents.some(
    (e) => e.target === userId && e.expiresAt > now && e.type === 'deal_spam'
  )
  if (hasInMemoryBlock) return true

  try {
    const redis = getRedisClient()
    const blocked = await redis.get(`blocked_user:${userId}`)
    if (blocked === 'true') return true
  } catch (err) {
    // Fail silently
  }

  return false
}
