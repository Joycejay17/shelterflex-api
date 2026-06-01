/**
 * Credit Bureau Report Store
 * Manages persistence of credit bureau reports with caching
 */

import { randomUUID } from "crypto";
import { getPool } from "../db.js";
import {
  CreditBureauReportRecord,
  CreateCreditBureauReportInput,
} from "./creditBureauReport.js";
import { logger } from "../utils/logger.js";

export interface ICreditBureauReportStore {
  create(
    input: CreateCreditBureauReportInput,
  ): Promise<CreditBureauReportRecord>;
  findLatestByTenantId(
    tenantId: string,
  ): Promise<CreditBureauReportRecord | null>;
  findById(id: string): Promise<CreditBureauReportRecord | null>;
  deleteExpired(): Promise<number>;
}

class PostgresCreditBureauReportStore implements ICreditBureauReportStore {
  async create(
    input: CreateCreditBureauReportInput,
  ): Promise<CreditBureauReportRecord> {
    const pool = getPool();
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days TTL

    const query = `
      INSERT INTO credit_bureau_reports 
      (id, tenant_id, bvn, nin, report, cached_at, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, tenant_id, bvn, nin, report, cached_at, expires_at, created_at, updated_at
    `;

    const result = await pool.query(query, [
      id,
      input.tenantId,
      input.bvn,
      input.nin,
      JSON.stringify(input.report),
      now,
      expiresAt,
      now,
      now,
    ]);

    return this.mapRow(result.rows[0]);
  }

  async findLatestByTenantId(
    tenantId: string,
  ): Promise<CreditBureauReportRecord | null> {
    const pool = getPool();
    const now = new Date();

    const query = `
      SELECT id, tenant_id, bvn, nin, report, cached_at, expires_at, created_at, updated_at
      FROM credit_bureau_reports
      WHERE tenant_id = $1 AND expires_at > $2
      ORDER BY cached_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [tenantId, now]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<CreditBureauReportRecord | null> {
    const pool = getPool();

    const query = `
      SELECT id, tenant_id, bvn, nin, report, cached_at, expires_at, created_at, updated_at
      FROM credit_bureau_reports
      WHERE id = $1
    `;

    const result = await pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async deleteExpired(): Promise<number> {
    const pool = getPool();
    const now = new Date();

    const query = `
      DELETE FROM credit_bureau_reports
      WHERE expires_at < $1
    `;

    const result = await pool.query(query, [now]);
    logger.info(`Deleted ${result.rowCount} expired credit bureau reports`);
    return result.rowCount || 0;
  }

  private mapRow(row: any): CreditBureauReportRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      bvn: row.bvn,
      nin: row.nin,
      report:
        typeof row.report === "string" ? JSON.parse(row.report) : row.report,
      cachedAt: new Date(row.cached_at),
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const creditBureauReportStore = new PostgresCreditBureauReportStore();
