/**
 * Rental Agreement Store
 * Manages persistence of rental agreements
 */

import { randomUUID } from "crypto";
import { getPool } from "../db.js";
import {
  RentalAgreement,
  RentalAgreementStatus,
  CreateRentalAgreementInput,
} from "./rentalAgreement.js";

export interface IRentalAgreementStore {
  create(input: CreateRentalAgreementInput): Promise<RentalAgreement>;
  findById(id: string): Promise<RentalAgreement | null>;
  findByDealId(dealId: string): Promise<RentalAgreement | null>;
  updateStatus(
    id: string,
    status: RentalAgreementStatus,
  ): Promise<RentalAgreement | null>;
  recordSignature(
    id: string,
    partyType: "tenant" | "landlord",
    signatureData: Record<string, unknown>,
  ): Promise<RentalAgreement | null>;
}

class PostgresRentalAgreementStore implements IRentalAgreementStore {
  async create(input: CreateRentalAgreementInput): Promise<RentalAgreement> {
    const pool = getPool();
    const id = randomUUID();
    const now = new Date();

    const query = `
      INSERT INTO rental_agreements
      (id, deal_id, pdf_key, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, deal_id, pdf_key, status, tenant_signed_at, landlord_signed_at, 
                tenant_signature_data, landlord_signature_data, created_at, updated_at
    `;

    const result = await pool.query(query, [
      id,
      input.dealId,
      input.pdfKey,
      RentalAgreementStatus.DRAFT,
      now,
      now,
    ]);

    return this.mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<RentalAgreement | null> {
    const pool = getPool();

    const query = `
      SELECT id, deal_id, pdf_key, status, tenant_signed_at, landlord_signed_at,
             tenant_signature_data, landlord_signature_data, created_at, updated_at
      FROM rental_agreements
      WHERE id = $1
    `;

    const result = await pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findByDealId(dealId: string): Promise<RentalAgreement | null> {
    const pool = getPool();

    const query = `
      SELECT id, deal_id, pdf_key, status, tenant_signed_at, landlord_signed_at,
             tenant_signature_data, landlord_signature_data, created_at, updated_at
      FROM rental_agreements
      WHERE deal_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [dealId]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async updateStatus(
    id: string,
    status: RentalAgreementStatus,
  ): Promise<RentalAgreement | null> {
    const pool = getPool();
    const now = new Date();

    const query = `
      UPDATE rental_agreements
      SET status = $2, updated_at = $3
      WHERE id = $1
      RETURNING id, deal_id, pdf_key, status, tenant_signed_at, landlord_signed_at,
                tenant_signature_data, landlord_signature_data, created_at, updated_at
    `;

    const result = await pool.query(query, [id, status, now]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async recordSignature(
    id: string,
    partyType: "tenant" | "landlord",
    signatureData: Record<string, unknown>,
  ): Promise<RentalAgreement | null> {
    const pool = getPool();
    const now = new Date();
    const fieldName =
      partyType === "tenant" ? "tenant_signed_at" : "landlord_signed_at";
    const dataFieldName =
      partyType === "tenant"
        ? "tenant_signature_data"
        : "landlord_signature_data";

    const query = `
      UPDATE rental_agreements
      SET ${fieldName} = $2, ${dataFieldName} = $3, updated_at = $4
      WHERE id = $1
      RETURNING id, deal_id, pdf_key, status, tenant_signed_at, landlord_signed_at,
                tenant_signature_data, landlord_signature_data, created_at, updated_at
    `;

    const result = await pool.query(query, [
      id,
      now,
      JSON.stringify(signatureData),
      now,
    ]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: any): RentalAgreement {
    return {
      id: row.id,
      dealId: row.deal_id,
      pdfKey: row.pdf_key,
      status: row.status,
      tenantSignedAt: row.tenant_signed_at
        ? new Date(row.tenant_signed_at)
        : undefined,
      landlordSignedAt: row.landlord_signed_at
        ? new Date(row.landlord_signed_at)
        : undefined,
      tenantSignatureData: row.tenant_signature_data
        ? typeof row.tenant_signature_data === "string"
          ? JSON.parse(row.tenant_signature_data)
          : row.tenant_signature_data
        : undefined,
      landlordSignatureData: row.landlord_signature_data
        ? typeof row.landlord_signature_data === "string"
          ? JSON.parse(row.landlord_signature_data)
          : row.landlord_signature_data
        : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const rentalAgreementStore = new PostgresRentalAgreementStore();
