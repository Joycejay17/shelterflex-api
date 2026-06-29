import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import {
  StubKycProvider,
  RealKycProvider,
  createKycProvider,
} from "./kycProvider.js";
import { logger } from "../utils/logger.js";
import type { KycSubmission } from "../schemas/kyc.js";

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const SUBMISSION: KycSubmission = {
  documentType: "passport",
  frontImageKey: "s3://docs/front-secret-key.jpg",
  backImageKey: "s3://docs/back-secret-key.jpg",
  livenessSignal: "liveness-token-xyz",
};

describe("kycProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe("StubKycProvider", () => {
    const provider = new StubKycProvider();

    it("submits and returns an approved state with a fresh external id", async () => {
      const result = await provider.submit(SUBMISSION);

      expect(result.success).toBe(true);
      expect(result.status).toBe("approved");
      expect(result.externalId).toBeTruthy();
    });

    it("generates a unique external id per submission session (no collisions)", async () => {
      const first = await provider.submit(SUBMISSION);
      const second = await provider.submit(SUBMISSION);

      expect(first.externalId).not.toBe(second.externalId);
    });

    it("checkStatus reports approved for any external id", async () => {
      const status = await provider.checkStatus("session-123");
      expect(status).toBe("approved");
    });

    it("webhookAuthenticate only accepts the expected signature", () => {
      expect(
        provider.webhookAuthenticate({ signature: "stub_valid_signature" }),
      ).toBe(true);
      expect(provider.webhookAuthenticate({ signature: "wrong" })).toBe(
        false,
      );
      expect(provider.webhookAuthenticate({})).toBe(false);
    });

    it("never logs raw identity document keys or liveness signal", async () => {
      await provider.submit(SUBMISSION);
      await provider.checkStatus("session-123");

      const allLogCalls = [
        ...vi.mocked(logger.info).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.error).mock.calls,
      ];

      for (const call of allLogCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(SUBMISSION.frontImageKey);
        expect(serialized).not.toContain(SUBMISSION.backImageKey);
        expect(serialized).not.toContain(SUBMISSION.livenessSignal);
      }
    });
  });

  describe("RealKycProvider", () => {
    function withRealProviderEnv() {
      process.env.KYC_PROVIDER_API_KEY = "test-api-key";
      process.env.KYC_PROVIDER_BASE_URL = "https://kyc.example.com";
    }

    it("refuses to construct without the required configuration", () => {
      delete process.env.KYC_PROVIDER_API_KEY;
      delete process.env.KYC_PROVIDER_BASE_URL;

      expect(() => new RealKycProvider()).toThrow();
    });

    describe("submit", () => {
      it("maps a successful response into the verification state", async () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();
        mockFetch({ id: "ext-1", status: "approved" });

        const result = await provider.submit(SUBMISSION);

        expect(result).toEqual({
          success: true,
          externalId: "ext-1",
          status: "approved",
        });
      });

      it.each([
        ["pending", "pending"],
        ["in_progress", "in_review"],
        ["approved", "approved"],
        ["rejected", "rejected"],
        ["expired", "expired"],
        ["some_unknown_provider_status", "pending"],
      ])(
        "maps provider status %s to platform status %s",
        async (providerStatus, expectedStatus) => {
          withRealProviderEnv();
          const provider = new RealKycProvider();
          mockFetch({ id: "ext-1", status: providerStatus });

          const result = await provider.submit(SUBMISSION);

          expect(result.status).toBe(expectedStatus);
        },
      );

      it("fails safe (does not throw, does not report verified) when the provider rejects the submission", async () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();
        mockFetch({ message: "invalid document" }, 422);

        const result = await provider.submit(SUBMISSION);

        expect(result.success).toBe(false);
        expect(result.status).toBeUndefined();
      });

      it("does not log raw document keys or liveness signal on success or failure", async () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();
        mockFetch({ id: "ext-1", status: "approved" });
        await provider.submit(SUBMISSION);

        mockFetch({ message: "invalid document" }, 422);
        await provider.submit(SUBMISSION);

        const allLogCalls = [
          ...vi.mocked(logger.info).mock.calls,
          ...vi.mocked(logger.warn).mock.calls,
          ...vi.mocked(logger.error).mock.calls,
        ];

        for (const call of allLogCalls) {
          const serialized = JSON.stringify(call);
          expect(serialized).not.toContain(SUBMISSION.frontImageKey);
          expect(serialized).not.toContain(SUBMISSION.backImageKey);
          expect(serialized).not.toContain(SUBMISSION.livenessSignal);
        }
      });
    });

    describe("checkStatus / expiry and re-verification", () => {
      it("fails safe to null (not falsely verified) when the provider call fails", async () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();
        mockFetch({ message: "not found" }, 404);

        const status = await provider.checkStatus("ext-1");

        expect(status).toBeNull();
      });

      it("always reflects the provider's current state rather than a cached prior result", async () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();

        mockFetch({ status: "approved" });
        const first = await provider.checkStatus("ext-1");
        expect(first).toBe("approved");

        // Same external id, but the provider now reports the verification has expired.
        mockFetch({ status: "expired" });
        const second = await provider.checkStatus("ext-1");
        expect(second).toBe("expired");
      });

      it("does not throw on a malformed status payload and falls back to pending", async () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();
        mockFetch({ status: "totally-unrecognized" });

        const status = await provider.checkStatus("ext-1");

        expect(status).toBe("pending");
      });
    });

    describe("webhookAuthenticate", () => {
      it("accepts a correctly signed payload and is deterministic (idempotent) for the same payload", () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();
        const payload = { id: "session-1", status: "approved" };
        const signature = crypto
          .createHmac("sha256", "test-api-key")
          .update(JSON.stringify(payload))
          .digest("hex");

        const signedPayload = { ...payload, signature };

        expect(provider.webhookAuthenticate(signedPayload)).toBe(true);
        // Re-checking the same signed payload yields the same result.
        expect(provider.webhookAuthenticate(signedPayload)).toBe(true);
      });

      it("rejects a tampered or missing signature", () => {
        withRealProviderEnv();
        const provider = new RealKycProvider();

        expect(
          provider.webhookAuthenticate({
            id: "session-1",
            status: "approved",
            signature: "not-the-right-signature",
          }),
        ).toBe(false);
        expect(
          provider.webhookAuthenticate({ id: "session-1", status: "approved" }),
        ).toBe(false);
      });
    });
  });

  describe("createKycProvider", () => {
    it("defaults to the stub provider when no provider type is configured", () => {
      delete process.env.KYC_PROVIDER_TYPE;
      const provider = createKycProvider();
      expect(provider.name).toBe("stub");
    });

    it("uses the stub provider for unrecognized provider types", () => {
      process.env.KYC_PROVIDER_TYPE = "something-else";
      const provider = createKycProvider();
      expect(provider.name).toBe("stub");
    });

    it("constructs the real provider when explicitly configured with credentials", () => {
      process.env.KYC_PROVIDER_TYPE = "real";
      process.env.KYC_PROVIDER_API_KEY = "test-api-key";
      process.env.KYC_PROVIDER_BASE_URL = "https://kyc.example.com";

      const provider = createKycProvider();
      expect(provider.name).toBe("real");
    });

    it("throws rather than silently falling back when real is requested without credentials", () => {
      process.env.KYC_PROVIDER_TYPE = "real";
      delete process.env.KYC_PROVIDER_API_KEY;
      delete process.env.KYC_PROVIDER_BASE_URL;

      expect(() => createKycProvider()).toThrow();
    });
  });
});
