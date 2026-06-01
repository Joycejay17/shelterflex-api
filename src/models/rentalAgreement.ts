/**
 * Rental Agreement Model
 * Stores generated rental agreements and signature status
 */

export enum RentalAgreementStatus {
  DRAFT = "draft",
  PENDING_SIGNATURES = "pending_signatures",
  FULLY_EXECUTED = "fully_executed",
}

export interface RentalAgreement {
  id: string;
  dealId: string;
  pdfKey: string; // Object storage key for the PDF
  status: RentalAgreementStatus;
  tenantSignedAt?: Date;
  landlordSignedAt?: Date;
  tenantSignatureData?: Record<string, unknown>;
  landlordSignatureData?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRentalAgreementInput {
  dealId: string;
  pdfKey: string;
}

export interface SignatureRequest {
  partyId: string;
  partyType: "tenant" | "landlord";
  email: string;
  token: string;
  expiresAt: Date;
}
