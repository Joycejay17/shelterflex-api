import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CreditBureauService } from "./creditBureauService.js";
import {
  initCreditBureauReportStore,
  InMemoryCreditBureauReportStore,
} from "../models/creditBureauReportStore.js";
import { getCreditBureauProvider } from "./creditBureau/CreditBureauFactory.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import type { CreditReport } from "./creditBureau/CreditBureauProvider.js";

vi.mock("./creditBureau/CreditBureauFactory.js");

const TENANT_ID = "tenant-1";
const BVN = "22123456789";
const NIN = "98765432109";

function makeReport(overrides: Partial<CreditReport> = {}): CreditReport {
  return {
    score: 720,
    derogatoryMarks: [],
    outstandingLoans: [],
    repaymentHistory: {
      onTimePaymentRate: 0.95,
      missedPayments: 0,
      defaultedLoans: 0,
    },
    reportDate: new Date("2024-01-01T00:00:00Z").toISOString(),
    expiresAt: new Date("2024-01-31T00:00:00Z").toISOString(),
    ...overrides,
  };
}

describe("CreditBureauService", () => {
  let store: InMemoryCreditBureauReportStore;
  let pullReportMock: ReturnType<typeof vi.fn>;
  function buildService(): CreditBureauService {
    return new CreditBureauService();
  }

  beforeEach(() => {
    store = new InMemoryCreditBureauReportStore();
    initCreditBureauReportStore(store);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    pullReportMock = vi.fn();
    vi.mocked(getCreditBureauProvider).mockReturnValue({
      pullReport: pullReportMock,
    } as any);

    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("pullReport - success path", () => {
    it("parses a successful pull into the credit report shape and caches/snapshots it", async () => {
      const report = makeReport({ score: 805 });
      pullReportMock.mockResolvedValue(report);

      const service = buildService();
      const result = await service.pullReport(TENANT_ID, BVN, NIN);

      expect(result).toEqual(report);
      expect(pullReportMock).toHaveBeenCalledWith(TENANT_ID, BVN, NIN);

      const cached = await store.findLatestByTenantId(TENANT_ID);
      expect(cached).not.toBeNull();
      expect(cached?.report).toEqual(report);
      expect(cached?.tenantId).toBe(TENANT_ID);
    });
  });

  describe("pullReport - freshness window", () => {
    it("reuses the cached report within the freshness window without re-pulling", async () => {
      const report = makeReport();
      pullReportMock.mockResolvedValue(report);

      const service = buildService();
      const first = await service.pullReport(TENANT_ID, BVN, NIN);
      expect(pullReportMock).toHaveBeenCalledTimes(1);

      // Advance the injected clock, but stay within the cached report's TTL.
      vi.setSystemTime(new Date("2024-01-15T00:00:00Z"));

      const second = await service.pullReport(TENANT_ID, BVN, NIN);

      expect(second).toEqual(first);
      expect(pullReportMock).toHaveBeenCalledTimes(1);
    });

    it("re-pulls from the bureau once the cached report has expired", async () => {
      const firstReport = makeReport({ score: 700 });
      const secondReport = makeReport({ score: 750 });
      pullReportMock
        .mockResolvedValueOnce(firstReport)
        .mockResolvedValueOnce(secondReport);

      const service = buildService();
      await service.pullReport(TENANT_ID, BVN, NIN);

      // Advance the injected clock past the cached report's expiresAt.
      vi.setSystemTime(new Date("2024-02-15T00:00:00Z"));

      const result = await service.pullReport(TENANT_ID, BVN, NIN);

      expect(result).toEqual(secondReport);
      expect(pullReportMock).toHaveBeenCalledTimes(2);
    });

    it("getCachedReport reflects the same freshness window as pullReport", async () => {
      const report = makeReport();
      pullReportMock.mockResolvedValue(report);

      const service = buildService();
      await service.pullReport(TENANT_ID, BVN, NIN);

      vi.setSystemTime(new Date("2024-01-15T00:00:00Z"));
      expect(await service.getCachedReport(TENANT_ID)).toEqual(report);

      vi.setSystemTime(new Date("2024-02-15T00:00:00Z"));
      expect(await service.getCachedReport(TENANT_ID)).toBeNull();
    });
  });

  describe("pullReport - bureau outage / timeout", () => {
    it("degrades gracefully to a controlled error when the bureau call fails, without caching a false clean report", async () => {
      pullReportMock.mockRejectedValue(new Error("bureau connection refused"));

      const service = buildService();

      await expect(service.pullReport(TENANT_ID, BVN, NIN)).rejects.toThrow(
        AppError,
      );

      try {
        await service.pullReport(TENANT_ID, BVN, NIN);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe(ErrorCode.EXTERNAL_SERVICE_ERROR);
        expect((error as AppError).status).toBe(503);
      }

      const cached = await store.findLatestByTenantId(TENANT_ID);
      expect(cached).toBeNull();
    });

    it("degrades gracefully when the bureau call times out", async () => {
      pullReportMock.mockImplementation(() => new Promise(() => {})); // never resolves

      const service = buildService();
      const pending = service.pullReport(TENANT_ID, BVN, NIN);
      const assertion = expect(pending).rejects.toThrow(AppError);

      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;

      const cached = await store.findLatestByTenantId(TENANT_ID);
      expect(cached).toBeNull();
    });

    it("does not throw uncaught errors and surfaces a controlled AppError instead of a crash", async () => {
      pullReportMock.mockRejectedValue(new Error("ECONNRESET"));
      const service = buildService();

      let caught: unknown;
      try {
        await service.pullReport(TENANT_ID, BVN, NIN);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AppError);
    });
  });

  describe("pullReport - malformed/partial bureau responses", () => {
    it("does not throw on a partial report missing optional collections", async () => {
      const partialReport = {
        score: 650,
        repaymentHistory: {
          onTimePaymentRate: 0.5,
          missedPayments: 2,
          defaultedLoans: 0,
        },
        reportDate: new Date("2024-01-01T00:00:00Z").toISOString(),
        expiresAt: new Date("2024-01-31T00:00:00Z").toISOString(),
      } as unknown as CreditReport;

      pullReportMock.mockResolvedValue(partialReport);
      const service = buildService();

      const result = await service.pullReport(TENANT_ID, BVN, NIN);

      expect(result).toEqual(partialReport);
      const cached = await store.findLatestByTenantId(TENANT_ID);
      expect(cached?.report).toEqual(partialReport);
    });

    it("does not throw when the bureau returns a null/empty payload", async () => {
      pullReportMock.mockResolvedValue(null as unknown as CreditReport);
      const service = buildService();

      const result = await service.pullReport(TENANT_ID, BVN, NIN);

      expect(result).toBeNull();
    });
  });

  describe("PII handling", () => {
    it("never logs raw bvn/nin values on the cache-hit path", async () => {
      const report = makeReport();
      pullReportMock.mockResolvedValue(report);
      const service = buildService();

      await service.pullReport(TENANT_ID, BVN, NIN);
      vi.setSystemTime(new Date("2024-01-10T00:00:00Z"));
      await service.pullReport(TENANT_ID, BVN, NIN);

      const allLogCalls = [
        ...vi.mocked(logger.info).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.error).mock.calls,
      ];

      for (const call of allLogCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(BVN);
        expect(serialized).not.toContain(NIN);
      }
    });

    it("never logs raw bvn/nin values on the bureau failure path", async () => {
      pullReportMock.mockRejectedValue(new Error("bureau down"));
      const service = buildService();

      await expect(
        service.pullReport(TENANT_ID, BVN, NIN),
      ).rejects.toThrow(AppError);

      const allLogCalls = [
        ...vi.mocked(logger.info).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.error).mock.calls,
      ];

      for (const call of allLogCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(BVN);
        expect(serialized).not.toContain(NIN);
      }
    });
  });
});
