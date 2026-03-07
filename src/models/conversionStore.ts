import { randomUUID } from "node:crypto";
import { type ConversionRecord } from "./conversion.js";

/**
 * In-memory conversion store.
 * Enforces once-per-deposit by unique depositId.
 */
class ConversionStore {
  private byId = new Map<string, ConversionRecord>();
  private byDepositId = new Map<string, string>();

  async getByConversionId(
    conversionId: string,
  ): Promise<ConversionRecord | null> {
    return this.byId.get(conversionId) ?? null;
  }

  async getByDepositId(depositId: string): Promise<ConversionRecord | null> {
    const id = this.byDepositId.get(depositId);
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  async createPending(input: {
    depositId: string;
    userId: string;
    amountNgn: number;
    provider: "onramp" | "offramp" | "manual_admin";
  }): Promise<ConversionRecord> {
    const existing = await this.getByDepositId(input.depositId);
    if (existing) return existing;

    const now = new Date();
    const record: ConversionRecord = {
      conversionId: randomUUID(),
      depositId: input.depositId,
      userId: input.userId,
      amountNgn: input.amountNgn,
      amountUsdc: "0",
      fxRateNgnPerUsdc: 0,
      provider: input.provider,
      providerRef: "",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failedAt: null,
      failureReason: null,
    };

    this.byId.set(record.conversionId, record);
    this.byDepositId.set(record.depositId, record.conversionId);

    return record;
  }

  async markCompleted(
    conversionId: string,
    data: {
      amountUsdc: string;
      fxRateNgnPerUsdc: number;
      providerRef: string;
    },
  ): Promise<ConversionRecord | null> {
    const existing = this.byId.get(conversionId);
    if (!existing) return null;

    const now = new Date();
    const updated: ConversionRecord = {
      ...existing,
      amountUsdc: data.amountUsdc,
      fxRateNgnPerUsdc: data.fxRateNgnPerUsdc,
      providerRef: data.providerRef,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      failedAt: null,
      failureReason: null,
    };

    this.byId.set(conversionId, updated);
    return updated;
  }

  async markFailed(
    conversionId: string,
    reason: string,
  ): Promise<ConversionRecord | null> {
    const existing = this.byId.get(conversionId);
    if (!existing) return null;

    const now = new Date();
    const updated: ConversionRecord = {
      ...existing,
      status: "failed",
      updatedAt: now,
      failedAt: now,
      failureReason: reason,
    };

    this.byId.set(conversionId, updated);
    return updated;
  }

  async listCompleted(): Promise<ConversionRecord[]> {
    const results: ConversionRecord[] = [];
    for (const record of this.byId.values()) {
      if (record.status === "completed") {
        results.push(record);
      }
    }
    return results.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async clear(): Promise<void> {
    this.byId.clear();
    this.byDepositId.clear();
  }
}

export const conversionStore = new ConversionStore();
