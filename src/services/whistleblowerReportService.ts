import { createCipheriv, randomBytes } from 'node:crypto'
import { whistleblowerRepository, type WhistleblowerReport } from '../repositories/WhistleblowerRepository.js'

function generateReferenceCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = randomBytes(6)
  let code = ''
  for (const byte of bytes) {
    code += chars[byte % chars.length]
  }
  return `WB-${code}`
}

function encryptEmail(email: string): string {
  const key = Buffer.from(
    process.env.ENCRYPTION_KEY ?? 'default-key-32-chars-padding!!!',
    'utf8',
  ).slice(0, 32)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}:${encrypted.toString('base64')}`
}

export class WhistleblowerReportService {
  async submitReport(
    data: {
      reportType: string
      description: string
      evidenceUrl?: string
      contactEmail?: string
    },
    ipAddress: string,
  ): Promise<{ referenceCode: string }> {
    const referenceCode = generateReferenceCode()

    const encryptedContactEmail = data.contactEmail
      ? encryptEmail(data.contactEmail)
      : undefined

    await whistleblowerRepository.createReport({
      reportType: data.reportType,
      description: data.description,
      evidenceUrl: data.evidenceUrl,
      encryptedContactEmail,
      referenceCode,
      ipAddress,
    })

    return { referenceCode }
  }

  async listReports(filters: {
    type?: string
    status?: string
    page: number
    pageSize: number
  }): Promise<{ reports: WhistleblowerReport[]; total: number }> {
    return whistleblowerRepository.listReports(filters)
  }

  async updateStatus(
    id: string,
    status: string,
    note: string,
    adminId: string,
  ): Promise<WhistleblowerReport> {
    return whistleblowerRepository.updateReportStatus(id, status, note, adminId)
  }
}

export const whistleblowerReportService = new WhistleblowerReportService()
