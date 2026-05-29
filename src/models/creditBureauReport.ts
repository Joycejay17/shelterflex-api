/**
 * Credit Bureau Report Model
 * Cached credit reports from external bureaus
 */

import { CreditReport } from "../services/creditBureau/CreditBureauProvider.js";

export interface CreditBureauReportRecord {
  id: string;
  tenantId: string;
  bvn: string; // Encrypted in production
  nin: string; // Encrypted in production
  report: CreditReport;
  cachedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCreditBureauReportInput {
  tenantId: string;
  bvn: string;
  nin: string;
  report: CreditReport;
}
