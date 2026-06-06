import { purgeExpiredRecords } from '../services/dataRetentionService.js'
import { logger } from '../utils/logger.js'

export const DATA_RETENTION_PURGE_JOB_NAME = 'data_retention.purge'

export interface DataRetentionPurgeJobPayload {
  scheduled?: boolean
}

/**
 * Job handler for purging expired soft-deleted records
 * This job runs periodically to permanently delete records that have exceeded the retention period
 */
export const dataRetentionPurgeJobHandler = async (job: { id?: string; payload?: DataRetentionPurgeJobPayload }): Promise<void> => {
  logger.info('Starting data retention purge job', {
    jobId: job.id,
  })

  try {
    const results = await purgeExpiredRecords()
    const totalDeleted = results.reduce((sum, r) => sum + r.recordsDeleted, 0)

    logger.info('Data retention purge job completed', {
      jobId: job.id,
      totalDeleted,
      tablesPurged: results.length,
    })
  } catch (error) {
    logger.error('Data retention purge job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
