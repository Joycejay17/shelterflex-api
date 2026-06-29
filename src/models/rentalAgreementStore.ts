/**
 * Rental Agreement Store (Hybrid pattern)
 * Manages persistence of rental agreements - falls back to in-memory for tests
 */

import { randomUUID } from "crypto";
import { getPool, type PgPoolLike } from "../db.js";
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
  clear(): Promise<void>;
}

class InMemoryRentalAgreementStore implements IRentalAgreementStore {
  private agreements = new Map<string, RentalAgreement>();
  private dealIndex = new Map<string, string>(); // dealId -> id

  async create(input: CreateRentalAgreementInput): Promise<RentalAgreement> {
    const id = randomUUID();
    const now = new Date();

    const agreement: RentalAgreement = {
      id,
      dealId: input.dealId,
      pdfKey: input.pdfKey,
      status: RentalAgreementStatus.DRAFT,
      createdAt: now,
      updatedAt: now,
    };

    this.agreements.set(id, agreement);
    this.dealIndex.set(input.dealId, id);
    return agreement;
  }

  async findById(id: string): Promise<RentalAgreement | null> {
    return this.agreements.get(id) ?? null;
  }

  async findByDealId(dealId: string): Promise<RentalAgreement | null> {
    const id = this.dealIndex.get(dealId);
    if (!id) return null;
    return this.agreements.get(id) ?? null;
  }

  async updateStatus(
    id: string,
    status: RentalAgreementStatus,
  ): Promise<RentalAgreement | null> {
    const agreement = this.agreements.get(id);
    if (!agreement) return null;

    agreement.status = status;
    agreement.updatedAt = new Date();
    this.agreements.set(id, agreement);
    return agreement;
  }

  async recordSignature(
    id: string,
    partyType: "tenant" | "landlord",
    signatureData: Record<string, unknown>,
  ): Promise<RentalAgreement | null> {
    const agreement = this.agreements.get(id);
    if (!agreement) return null;

    if (partyType === "tenant") {
      agreement.tenantSignedAt = new Date();
      agreement.tenantSignatureData = signatureData;
    } else {
      agreement.landlordSignedAt = new Date();
      agreement.landlordSignatureData = signatureData;
    }

    agreement.updatedAt = new Date();

    // Check if both signed, update status
    if (agreement.tenantSignedAt && agreement.landlordSignedAt) {
      agreement.status = RentalAgreementStatus.FULLY_EXECUTED;
    } else if (agreement.tenantSignedAt || agreement.landlordSignedAt) {
      agreement.status = RentalAgreementStatus.PENDING_SIGNATURES;
    }

    this.agreements.set(id, agreement);
    return agreement;
  }

  async clear(): Promise<void> {
    this.agreements.clear();
    this.dealIndex.clear();
  }
}

type RentalAgreementRow = {
  id: string;
  deal_id: string;
  pdf_key: string;
  status: RentalAgreementStatus;
  tenant_signed_at: Date | null;
  landlord_signed_at: Date | null;
  tenant_signature_data: string | null;
  landlord_signature_data: string | null;
  created_at: Date;
  updated_at: Date;
};

class PostgresRentalAgreementStore implements IRentalAgreementStore {
  private async pool(): Promise<PgPoolLike> {
    const p = await getPool();
    if (!p) {
      throw new Error(
        "Database pool is not available (DATABASE_URL/pg not configured)",
      );
    }
    return p;
  }

  async isAvailable(): Promise<boolean> {
    return (await getPool()) !== null;
  }

  async create(input: CreateRentalAgreementInput): Promise<RentalAgreement> {
    const pool = await this.pool();
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
    const pool = await this.pool();

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
    const pool = await this.pool();

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
    const pool = await this.pool();
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
    const pool = await this.pool();
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

  async clear(): Promise<void> {
    if (process.env.NODE_ENV !== "test") {
      throw new Error(
        "rentalAgreementStore.clear() is only supported in test env",
      );
    }
    const pool = await this.pool();
    await pool.query("TRUNCATE rental_agreements RESTART IDENTITY CASCADE");
  }

  private mapRow(row: RentalAgreementRow): RentalAgreement {
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

class HybridRentalAgreementStore implements IRentalAgreementStore {
  private memory = new InMemoryRentalAgreementStore();
  private postgres = new PostgresRentalAgreementStore();

  private async adapter(): Promise<IRentalAgreementStore> {
    if (await this.postgres.isAvailable()) {
      return this.postgres;
    }
    return this.memory;
  }

  async create(input: CreateRentalAgreementInput): Promise<RentalAgreement> {
    return (await this.adapter()).create(input);
  }

  async findById(id: string): Promise<RentalAgreement | null> {
    return (await this.adapter()).findById(id);
  }

  async findByDealId(dealId: string): Promise<RentalAgreement | null> {
    return (await this.adapter()).findByDealId(dealId);
  }

  async updateStatus(
    id: string,
    status: RentalAgreementStatus,
  ): Promise<RentalAgreement | null> {
    return (await this.adapter()).updateStatus(id, status);
  }

  async recordSignature(
    id: string,
    partyType: "tenant" | "landlord",
    signatureData: Record<string, unknown>,
  ): Promise<RentalAgreement | null> {
    return (await this.adapter()).recordSignature(id, partyType, signatureData);
  }

  async clear(): Promise<void> {
    return (await this.adapter()).clear();
  }
}

export const rentalAgreementStore = new HybridRentalAgreementStore();
