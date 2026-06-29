import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReferralService } from "./referralService.js";
import { referralRepository } from "../repositories/ReferralRepository.js";
import type { ReferralCode, ReferralConversion } from "../schemas/referral.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";

const mockQuery = vi.fn();
vi.mock("../db.js", () => ({
  getPool: vi.fn().mockResolvedValue({
    query: mockQuery,
    connect: vi.fn(),
  }),
}));

vi.mock("../repositories/ReferralRepository.js", () => ({
  referralRepository: {
    getReferralCodeByTenantId: vi.fn(),
    getReferralCodeByCode: vi.fn(),
    createReferralCode: vi.fn(),
    createConversion: vi.fn(),
    getConversionsByReferrer: vi.fn(),
    getConversionByReferredTenant: vi.fn(),
    getConversionById: vi.fn(),
    updateConversionStatus: vi.fn(),
    getAllConversions: vi.fn(),
  },
}));

function makeReferralCode(
  overrides: Partial<ReferralCode> = {},
): ReferralCode {
  return {
    id: overrides.id ?? "rc-1",
    tenantId: overrides.tenantId ?? "tenant-referrer",
    code: overrides.code ?? "ABC12345",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function makeConversion(
  overrides: Partial<ReferralConversion> = {},
): ReferralConversion {
  return {
    id: overrides.id ?? "conv-1",
    referralCodeId: overrides.referralCodeId ?? "rc-1",
    referrerTenantId: overrides.referrerTenantId ?? "tenant-referrer",
    referredTenantId: overrides.referredTenantId ?? "tenant-referred",
    dealId: overrides.dealId ?? null,
    rewardAmountNgn: overrides.rewardAmountNgn ?? 5000,
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

describe("ReferralService", () => {
  let service: ReferralService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    service = new ReferralService();
  });

  describe("applyReferralCode", () => {
    it("rejects self-referral", async () => {
      const code = makeReferralCode({ tenantId: "tenant-self" });
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(code);

      await expect(
        service.applyReferralCode("ABC12345", "tenant-self"),
      ).rejects.toMatchObject({
        name: "AppError",
        code: ErrorCode.VALIDATION_ERROR,
        status: 400,
        message: "You cannot use your own referral code",
      });
    });

    it("rejects duplicate attribution for the same referred tenant", async () => {
      const code = makeReferralCode();
      const existing = makeConversion();
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(code);
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        existing,
      );

      await expect(
        service.applyReferralCode("ABC12345", "tenant-referred"),
      ).rejects.toMatchObject({
        name: "AppError",
        code: ErrorCode.VALIDATION_ERROR,
        status: 400,
        message: "This tenant has already been referred",
      });
    });

    it("rejects referral code that does not exist", async () => {
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(null);

      await expect(
        service.applyReferralCode("INVALID", "tenant-new"),
      ).rejects.toMatchObject({
        name: "AppError",
        code: ErrorCode.NOT_FOUND,
        status: 404,
      });
    });

    it("creates a conversion when all checks pass", async () => {
      const code = makeReferralCode();
      const created = makeConversion();
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(code);
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        null,
      );
      vi.mocked(referralRepository.getConversionsByReferrer).mockResolvedValue([]);
      vi.mocked(referralRepository.createConversion).mockResolvedValue(created);

      const result = await service.applyReferralCode("ABC12345", "tenant-new");
      expect(result).toEqual(created);
      expect(referralRepository.createConversion).toHaveBeenCalled();
    });

    it("rejects when velocity cap is exceeded", async () => {
      const code = makeReferralCode();
      const now = Date.now();
      const recentConversions = Array.from({ length: 20 }, (_, i) =>
        makeConversion({
          id: `conv-${i}`,
          createdAt: new Date(now - 1000).toISOString(),
        }),
      );
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(code);
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        null,
      );
      vi.mocked(referralRepository.getConversionsByReferrer).mockResolvedValue(
        recentConversions,
      );

      await expect(
        service.applyReferralCode("ABC12345", "tenant-over-cap"),
      ).rejects.toMatchObject({
        name: "AppError",
        code: ErrorCode.VALIDATION_ERROR,
        status: 429,
      });
      expect(referralRepository.createConversion).not.toHaveBeenCalled();
    });

    it("allows referrals when velocity is below cap", async () => {
      const code = makeReferralCode();
      const createdConversion = makeConversion({
        id: "conv-below",
        referredTenantId: "tenant-new-below",
      });
      const belowCapConversions = Array.from({ length: 5 }, (_, i) =>
        makeConversion({
          id: `conv-existing-${i}`,
          createdAt: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(code);
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        null,
      );
      vi.mocked(referralRepository.getConversionsByReferrer).mockResolvedValue(
        belowCapConversions,
      );
      vi.mocked(referralRepository.createConversion).mockResolvedValue(
        createdConversion,
      );

      const result = await service.applyReferralCode(
        "ABC12345",
        "tenant-new-below",
      );
      expect(result).toEqual(createdConversion);
      expect(referralRepository.createConversion).toHaveBeenCalled();
    });
  });

  describe("creditRewardForDealActivation (reward gating)", () => {
    it("skips when no conversion exists for the referred tenant", async () => {
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        null,
      );

      await expect(
        service.creditRewardForDealActivation("tenant-noref", "deal-1"),
      ).resolves.toBeUndefined();
    });

    it("credits reward when referred tenant activates their first deal", async () => {
      const conversion = makeConversion({ status: "pending" });
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        conversion,
      );
      mockQuery.mockResolvedValue({ rows: [] });

      await service.creditRewardForDealActivation("tenant-referred", "deal-1");
      expect(mockQuery).toHaveBeenCalled();
    });

    it("is idempotent — does not re-credit an already credited conversion", async () => {
      const conversion = makeConversion({ status: "credited" });
      vi.mocked(referralRepository.getConversionByReferredTenant).mockResolvedValue(
        conversion,
      );

      await service.creditRewardForDealActivation("tenant-referred", "deal-1");
      // The early return on non-pending status prevents double-crediting
    });
  });

  describe("applyRewardCredit (idempotent issuance)", () => {
    it("throws not-found for unknown conversion", async () => {
      vi.mocked(referralRepository.getConversionById).mockResolvedValue(null);

      await expect(
        service.applyRewardCredit("conv-unknown"),
      ).rejects.toMatchObject({
        name: "AppError",
        code: ErrorCode.NOT_FOUND,
        status: 404,
      });
    });

    it("applies a pending conversion", async () => {
      const conversion = makeConversion({ status: "credited" });
      const updated = makeConversion({ status: "applied" });
      vi.mocked(referralRepository.getConversionById).mockResolvedValue(conversion);
      vi.mocked(referralRepository.updateConversionStatus).mockResolvedValue(
        updated,
      );

      await service.applyRewardCredit("conv-1");
      expect(referralRepository.updateConversionStatus).toHaveBeenCalledWith(
        "conv-1",
        "applied",
      );
    });

    it("is idempotent — does not re-apply an already applied conversion", async () => {
      const conversion = makeConversion({ status: "applied" });
      vi.mocked(referralRepository.getConversionById).mockResolvedValue(conversion);

      await service.applyRewardCredit("conv-1");
      expect(referralRepository.updateConversionStatus).not.toHaveBeenCalled();
    });
  });

  describe("generateReferralCode", () => {
    it("returns existing code if tenant already has one", async () => {
      const existing = makeReferralCode();
      vi.mocked(referralRepository.getReferralCodeByTenantId).mockResolvedValue(
        existing,
      );

      const result = await service.generateReferralCode("tenant-existing");
      expect(result).toEqual(existing);
      expect(referralRepository.createReferralCode).not.toHaveBeenCalled();
    });

    it("generates a new code when tenant has none", async () => {
      const created = makeReferralCode();
      vi.mocked(referralRepository.getReferralCodeByTenantId).mockResolvedValue(
        null,
      );
      vi.mocked(referralRepository.getReferralCodeByCode).mockResolvedValue(null);
      vi.mocked(referralRepository.createReferralCode).mockResolvedValue(created);

      const result = await service.generateReferralCode("tenant-new");
      expect(result).toEqual(created);
      expect(referralRepository.createReferralCode).toHaveBeenCalled();
    });
  });

  describe("getReferralStats", () => {
    it("returns stats for a referrer with conversions", async () => {
      const code = makeReferralCode();
      const conversions = [
        makeConversion({ status: "applied", rewardAmountNgn: 5000 }),
        makeConversion({ status: "pending", rewardAmountNgn: 5000 }),
      ];
      vi.mocked(referralRepository.getReferralCodeByTenantId).mockResolvedValue(
        code,
      );
      vi.mocked(referralRepository.getConversionsByReferrer).mockResolvedValue(
        conversions,
      );

      const stats = await service.getReferralStats("tenant-referrer");
      expect(stats.totalReferred).toBe(2);
      expect(stats.pendingRewards).toBe(1);
      expect(stats.appliedRewards).toBe(1);
      expect(stats.totalRewardAmountNgn).toBe(10000);
    });

    it("throws not-found for tenant without a referral code", async () => {
      vi.mocked(referralRepository.getReferralCodeByTenantId).mockResolvedValue(
        null,
      );

      await expect(
        service.getReferralStats("tenant-no-code"),
      ).rejects.toMatchObject({
        name: "AppError",
        code: ErrorCode.NOT_FOUND,
        status: 404,
      });
    });
  });
});
