import crypto from 'node:crypto'
import { getScheduler } from '../jobs/scheduler/index.js'
import {
  WebhookEventType,
  webhookSubscriptionStore,
  webhookDeliveryStore,
} from '../models/webhookSubscription.js'

// Exponential backoff values in milliseconds: 1m, 5m, 30m, 2h, 8h
const BACKOFF_MS = [
  60 * 1000,          // 1 minute
  5 * 60 * 1000,      // 5 minutes
  30 * 60 * 1000,     // 30 minutes
  2 * 60 * 60 * 1000, // 2 hours
  8 * 60 * 60 * 1000  // 8 hours
]

export function computeHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export async function enqueueDelivery(
  event: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  const activeSubs = webhookSubscriptionStore.listActiveByEvent(event)
  const scheduler = getScheduler()

  for (const sub of activeSubs) {
    const jobPayload = {
      subscriptionId: sub.id,
      event,
      payload,
      attemptCount: 0
    }

    await scheduler.schedule({
      name: `webhook.delivery.${sub.id}.${Date.now()}`,
      handler: 'webhook.delivery',
      payload: jobPayload,
      maxRetries: 0 // Handled manually to respect exact backoff tiers
    })
  }
}

export async function processWebhookDeliveryJob(jobPayload: {
  subscriptionId: string
  event: WebhookEventType
  payload: Record<string, unknown>
  attemptCount: number
}): Promise<void> {
  const { subscriptionId, event, payload, attemptCount } = jobPayload
  const sub = webhookSubscriptionStore.findById(subscriptionId)
  if (!sub || !sub.active) {
    return
  }

  const currentAttempt = attemptCount + 1
  const bodyString = JSON.stringify(payload)
  
  // HMAC-SHA256 signature calculated from shared secret hash
  const signature = computeHmacSignature(bodyString, sub.secret)

  let responseCode: number | undefined
  let responseBody = ''
  let status: 'delivered' | 'failed' | 'permanently_failed' = 'failed'

  try {
    const res = await fetch(sub.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body: bodyString,
    })

    responseCode = res.status
    responseBody = await res.text()
    if (res.status >= 200 && res.status < 300) {
      status = 'delivered'
    }
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err)
  }

  const truncatedBody = responseBody.slice(0, 500)

  webhookDeliveryStore.logAttempt({
    subscriptionId,
    event,
    payload,
    status: status === 'delivered' ? 'delivered' : (currentAttempt >= 5 ? 'permanently_failed' : 'failed'),
    responseCode,
    responseBody: truncatedBody,
  })

  if (status === 'delivered') {
    return
  }

  if (currentAttempt < 5) {
    const delay = BACKOFF_MS[currentAttempt - 1] || 60 * 1000
    const nextRunAt = new Date(Date.now() + delay)

    await getScheduler().schedule({
      name: `webhook.delivery.${subscriptionId}.retry.${currentAttempt}.${Date.now()}`,
      handler: 'webhook.delivery',
      payload: {
        subscriptionId,
        event,
        payload,
        attemptCount: currentAttempt
      },
      nextRunAt,
      maxRetries: 0
    })
  } else {
    webhookSubscriptionStore.updateActive(subscriptionId, false)
  }
}
