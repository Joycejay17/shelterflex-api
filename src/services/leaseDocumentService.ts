/**
 * Lease Document Service
 * Generates lease agreement documents from deal parameters
 */

import { randomUUID } from 'node:crypto'
import { Deal } from '../models/deal.js'
import { leaseAgreementStore, LeaseStatus } from '../models/leaseAgreementStore.js'

export interface LeaseTemplateData {
  tenantName: string
  landlordName: string
  propertyAddress: string
  annualRentNgn: number
  paymentType: string
  depositAmount: number
  termMonths: number
  startDate: string
  leaseDuration: string
  platformTerms: string
}

/**
 * Generate a lease draft for a deal
 * In production, this would generate a PDF using pdfkit
 * For now, we create a document key and store the lease record
 */
export async function generateLeaseDraft(
  dealId: string,
  templateData: LeaseTemplateData,
): Promise<{ leaseId: string; documentKey: string }> {
  const documentKey = `lease/${dealId}/${randomUUID()}.pdf`

  // Check if a non-voided lease already exists for this deal
  const existingLease = await leaseAgreementStore.getByDealId(dealId)
  if (existingLease && existingLease.status !== LeaseStatus.VOIDED) {
    throw new Error(`A lease agreement already exists for deal ${dealId}. Void the existing lease first.`)
  }

  const lease = await leaseAgreementStore.create({
    dealId,
    documentKey,
  })

  // In production, generate PDF here using pdfkit
  // For now, we just store the lease record
  // The documentKey would point to the generated PDF in storage

  return {
    leaseId: lease.leaseId,
    documentKey,
  }
}

/**
 * Get lease template data from a deal
 * In production, this would fetch tenant/landlord names from user service
 */
export function buildLeaseTemplateData(
  deal: Deal,
  propertyAddress: string,
): LeaseTemplateData {
  return {
    tenantName: `Tenant ${deal.tenantId}`,
    landlordName: `Landlord ${deal.landlordId}`,
    propertyAddress,
    annualRentNgn: deal.annualRentNgn,
    paymentType: deal.paymentType || 'installment',
    depositAmount: deal.depositNgn,
    termMonths: deal.termMonths,
    startDate: new Date().toISOString().split('T')[0],
    leaseDuration: `${deal.termMonths} months`,
    platformTerms: 'This lease agreement is facilitated by Shelterflex. All payments are processed through the Shelterflex platform.',
  }
}
