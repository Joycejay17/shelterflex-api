/**
 * Background Check Service
 * Orchestrates employment, income, and bank statement verification for tenant screening
 */

import { getBackgroundCheckProvider } from "./backgroundCheck/BackgroundCheckFactory.js";
import { backgroundCheckResultStore } from "../models/backgroundCheckResultStore.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";

export interface BackgroundCheckInput {
  tenantId: string;
  applicationId?: string;
  employerName?: string;
  employeeId?: string;
  bankAccountRef?: string;
  statementFile?: string;
  skipEmployment?: boolean;
  skipIncome?: boolean;
  skipBankStatement?: boolean;
}

export interface BackgroundCheckOutput {
  id: string;
  tenantId: string;
  applicationId?: string;
  employmentVerification?: {
    verified: boolean;
    employerName: string;
    jobTitle: string;
    startDate: string;
    employmentType: string;
    monthlyIncome?: number;
  };
  incomeVerification?: {
    averageMonthlyIncome: number;
    incomeStability: string;
    lastSalaryDate: string;
    transactionCount3m: number;
  };
  bankStatementVerification?: {
    averageBalance: number;
    monthlyInflow: number;
    monthlyOutflow: number;
    overdraftCount: number;
  };
  overallStatus: string;
  provider: string;
  createdAt: string;
}

export class BackgroundCheckService {
  private provider = getBackgroundCheckProvider();

  /**
   * Run full background check for a tenant
   */
  async runFullCheck(input: BackgroundCheckInput): Promise<BackgroundCheckOutput> {
    logger.info(`Starting full background check for tenant ${input.tenantId}`);

    // Create initial record with pending status
    const result = await backgroundCheckResultStore.create({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      overallStatus: "pending",
      provider: "mock",
    });

    let employmentData;
    let incomeData;
    let bankData;

    try {
      // Employment verification
      if (!input.skipEmployment && input.employerName) {
        try {
          employmentData = await this.withTimeout(
            this.provider.verifyEmployment(
              input.tenantId,
              input.employerName,
              input.employeeId,
            ),
            15000,
          );
          logger.info(
            `Employment verification completed for tenant ${input.tenantId}`,
          );
        } catch (error) {
          logger.error(
            `Employment verification failed for tenant ${input.tenantId}:`,
            error,
          );
          throw new AppError(
            ErrorCode.EXTERNAL_SERVICE_ERROR,
            503,
            "Employment verification service unavailable",
          );
        }
      }

      // Income verification
      if (!input.skipIncome && input.bankAccountRef) {
        try {
          incomeData = await this.withTimeout(
            this.provider.verifyIncome(input.tenantId, input.bankAccountRef),
            15000,
          );
          logger.info(
            `Income verification completed for tenant ${input.tenantId}`,
          );
        } catch (error) {
          logger.error(
            `Income verification failed for tenant ${input.tenantId}:`,
            error,
          );
          throw new AppError(
            ErrorCode.EXTERNAL_SERVICE_ERROR,
            503,
            "Income verification service unavailable",
          );
        }
      }

      // Bank statement verification
      if (!input.skipBankStatement && input.statementFile) {
        try {
          bankData = await this.withTimeout(
            this.provider.verifyBankStatement(input.tenantId, input.statementFile),
            20000,
          );
          logger.info(
            `Bank statement verification completed for tenant ${input.tenantId}`,
          );
        } catch (error) {
          logger.error(
            `Bank statement verification failed for tenant ${input.tenantId}:`,
            error,
          );
          throw new AppError(
            ErrorCode.EXTERNAL_SERVICE_ERROR,
            503,
            "Bank statement verification service unavailable",
          );
        }
      }

      // Update result with completed status
      const updated = await backgroundCheckResultStore.update(result.id, {
        employmentVerified: employmentData?.verified,
        employerName: employmentData?.employerName,
        jobTitle: employmentData?.jobTitle,
        employmentStartDate: employmentData?.startDate,
        employmentType: employmentData?.employmentType,
        employmentMonthlyIncome: employmentData?.monthlyIncome,
        employmentVerificationDate: employmentData?.verificationDate,
        incomeAverageMonthly: incomeData?.averageMonthlyIncome,
        incomeStability: incomeData?.incomeStability,
        incomeLastSalaryDate: incomeData?.lastSalaryDate,
        incomeTransactionCount3m: incomeData?.transactionCount3m,
        incomeVerificationDate: incomeData?.verificationDate,
        bankAverageBalance: bankData?.averageBalance,
        bankMonthlyInflow: bankData?.monthlyInflow,
        bankMonthlyOutflow: bankData?.monthlyOutflow,
        bankOverdraftCount: bankData?.overdraftCount,
        bankStatementStartDate: bankData?.statementPeriod?.startDate,
        bankStatementEndDate: bankData?.statementPeriod?.endDate,
        bankVerificationDate: bankData?.verificationDate,
        overallStatus: "completed",
      });

      logger.info(
        `Full background check completed for tenant ${input.tenantId}`,
      );

      return this.mapToOutput(updated);
    } catch (error) {
      // Mark as failed on error
      await backgroundCheckResultStore.update(result.id, {
        overallStatus: "failed",
      });
      throw error;
    }
  }

  /**
   * Get latest background check result for a tenant
   */
  async getLatestCheck(tenantId: string): Promise<BackgroundCheckOutput | null> {
    const result = await backgroundCheckResultStore.findLatestByTenantId(
      tenantId,
    );
    return result ? this.mapToOutput(result) : null;
  }

  /**
   * Get background check result by ID
   */
  async getCheckById(id: string): Promise<BackgroundCheckOutput | null> {
    const result = await backgroundCheckResultStore.findById(id);
    return result ? this.mapToOutput(result) : null;
  }

  /**
   * Get background checks for an application
   */
  async getChecksByApplicationId(
    applicationId: string,
  ): Promise<BackgroundCheckOutput[]> {
    const results =
      await backgroundCheckResultStore.findByApplicationId(applicationId);
    return results.map((r) => this.mapToOutput(r));
  }

  /**
   * Utility: Promise with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), timeoutMs),
      ),
    ]);
  }

  /**
   * Map database result to output format
   */
  private mapToOutput(result: any): BackgroundCheckOutput {
    const output: BackgroundCheckOutput = {
      id: result.id,
      tenantId: result.tenantId,
      applicationId: result.applicationId,
      overallStatus: result.overallStatus,
      provider: result.provider,
      createdAt: result.createdAt,
    };

    if (result.employmentVerified !== undefined) {
      output.employmentVerification = {
        verified: result.employmentVerified,
        employerName: result.employerName || "",
        jobTitle: result.jobTitle || "",
        startDate: result.employmentStartDate || "",
        employmentType: result.employmentType || "",
        monthlyIncome: result.employmentMonthlyIncome,
      };
    }

    if (result.incomeAverageMonthly !== undefined) {
      output.incomeVerification = {
        averageMonthlyIncome: result.incomeAverageMonthly,
        incomeStability: result.incomeStability || "",
        lastSalaryDate: result.incomeLastSalaryDate || "",
        transactionCount3m: result.incomeTransactionCount3m || 0,
      };
    }

    if (result.bankAverageBalance !== undefined) {
      output.bankStatementVerification = {
        averageBalance: result.bankAverageBalance,
        monthlyInflow: result.bankMonthlyInflow || 0,
        monthlyOutflow: result.bankMonthlyOutflow || 0,
        overdraftCount: result.bankOverdraftCount || 0,
      };
    }

    return output;
  }
}

export const backgroundCheckService = new BackgroundCheckService();
