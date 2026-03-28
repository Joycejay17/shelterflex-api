import { Redis } from 'ioredis'
import { env } from '../schemas/env.js'

let redis: Redis | null = null

export function getRedisClient(): Redis {
    if (!redis) {
        redis = new Redis(env.REDIS_URL, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000)
                return delay
            },
        })

        redis.on('error', (err) => {
            console.error('[redis] unexpected error:', err)
        })

        redis.on('connect', () => {
            console.log('[redis] connected to', env.REDIS_URL)
        })
    }

    return redis
}

export async function closeRedis() {
    if (redis) {
        await redis.quit()
        redis = null
    }
}
