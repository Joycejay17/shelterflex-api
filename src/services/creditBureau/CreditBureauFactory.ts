/**
 * Credit Bureau Provider Factory
 * Selects the appropriate provider based on configuration
 */

import { CreditBureauProvider } from "./CreditBureauProvider.js";
import { MockCreditBureauProvider } from "./MockCreditBureauProvider.js";
import { logger } from "../../utils/logger.js";

const PROVIDER = process.env.CREDIT_BUREAU_PROVIDER || "mock";

let providerInstance: CreditBureauProvider | null = null;

export function getCreditBureauProvider(): CreditBureauProvider {
  if (providerInstance) {
    return providerInstance;
  }

  switch (PROVIDER.toLowerCase()) {
    case "mock":
      providerInstance = new MockCreditBureauProvider();
      logger.info("Initialized MockCreditBureauProvider");
      break;
    case "crc":
      // Placeholder for CRC provider implementation
      logger.warn("CRC provider not yet implemented, falling back to mock");
      providerInstance = new MockCreditBureauProvider();
      break;
    case "first_central":
      // Placeholder for FirstCentral provider implementation
      logger.warn(
        "FirstCentral provider not yet implemented, falling back to mock",
      );
      providerInstance = new MockCreditBureauProvider();
      break;
    default:
      logger.warn(`Unknown provider ${PROVIDER}, using mock`);
      providerInstance = new MockCreditBureauProvider();
  }

  return providerInstance;
}

export function resetProviderForTesting(): void {
  providerInstance = null;
}
