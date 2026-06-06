import { randomBytes } from 'node:crypto'

export interface WhistleblowerReport {
  id: string
  referenceCode: string
  reportType: string
  description: string
  evidenceUrl?: string
  status: string
  createdAt: Date
  updatedAt: Date
  adminNote?: string
}

interface StoredReport extends WhistleblowerReport {
  encryptedContactEmail?: string
  ipAddress: string
}

function generateId(): string {
  return randomBytes(16).toString('hex')
}

export class WhistleblowerRepository {
  private store = new Map<string, StoredReport>()

  async createReport(data: {
    reportType: string
    description: string
    evidenceUrl?: string
    encryptedContactEmail?: string
    referenceCode: string
    ipAddress: string
  }): Promise<WhistleblowerReport> {
    const now = new Date()
    const record: StoredReport = {
      id: generateId(),
      referenceCode: data.referenceCode,
      reportType: data.reportType,
      description: data.description,
      evidenceUrl: data.evidenceUrl,
      encryptedContactEmail: data.encryptedContactEmail,
      status: 'pending',
      ipAddress: data.ipAddress,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(record.id, record)
    return this.toPublic(record)
  }

  async listReports(filters: {
    type?: string
    status?: string
    page: number
    pageSize: number
  }): Promise<{ reports: WhistleblowerReport[]; total: number }> {
    let items = Array.from(this.store.values())

    if (filters.type) {
      items = items.filter((r) => r.reportType === filters.type)
    }
    if (filters.status) {
      items = items.filter((r) => r.status === filters.status)
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const total = items.length
    const offset = (filters.page - 1) * filters.pageSize
    const page = items.slice(offset, offset + filters.pageSize)

    return { reports: page.map(this.toPublic), total }
  }

  async getReportById(id: string): Promise<WhistleblowerReport | null> {
    const record = this.store.get(id)
    return record ? this.toPublic(record) : null
  }

  async updateReportStatus(
    id: string,
    status: string,
    note: string,
    _adminId: string,
  ): Promise<WhistleblowerReport> {
    const record = this.store.get(id)
    if (!record) {
      throw new Error(`Report with id '${id}' not found`)
    }
    record.status = status
    record.adminNote = note
    record.updatedAt = new Date()
    this.store.set(id, record)
    return this.toPublic(record)
  }

  async countRecentByIp(ipAddress: string, windowMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowMs)
    let count = 0
    for (const record of this.store.values()) {
      if (record.ipAddress === ipAddress && record.createdAt >= cutoff) {
        count++
      }
    }
    return count
  }

  private toPublic(record: StoredReport): WhistleblowerReport {
    return {
      id: record.id,
      referenceCode: record.referenceCode,
      reportType: record.reportType,
      description: record.description,
      evidenceUrl: record.evidenceUrl,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      adminNote: record.adminNote,
    }
  }
}

export const whistleblowerRepository = new WhistleblowerRepository()
