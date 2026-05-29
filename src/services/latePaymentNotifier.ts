import { notificationService } from './notificationService.js'
import { getNotificationService } from '../notifications/notificationService.js'
import { NotificationChannel } from '../notifications/types.js'
import { PostgresUserRepository } from '../repositories/AuthRepository.js'

/** Test hook: map userId → email when DB is unavailable. */
const testEmailByUserId = new Map<string, string>()

export function setTestUserEmail(userId: string, email: string): void {
  testEmailByUserId.set(userId, email)
}

export function clearTestUserEmails(): void {
  testEmailByUserId.clear()
}

async function resolveEmail(userId: string): Promise<string | null> {
  const test = testEmailByUserId.get(userId)
  if (test) return test
  try {
    const repo = new PostgresUserRepository()
    const user = await repo.getById(userId)
    return user?.email ?? null
  } catch {
    return null
  }
}

export async function sendLatePaymentNotification(input: {
  userId: string
  title: string
  body: string
  dedupeKey: string
  template: 'payment_due' | 'payment_overdue'
  data: Record<string, unknown>
}): Promise<void> {
  await notificationService.create(input.userId, {
    category: 'payment',
    title: input.title,
    body: input.body,
    data: input.data,
    dedupeKey: input.dedupeKey,
  })

  const email = await resolveEmail(input.userId)
  if (email) {
    await getNotificationService().enqueue({
      channel: NotificationChannel.EMAIL,
      recipient: email,
      subject: input.title,
      body: input.body,
      html: `<p>${input.body}</p>`,
      metadata: { template: input.template, ...input.data },
    })
  }
}
