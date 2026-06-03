import { getPool } from '../db.js'
import { logger } from '../utils/logger.js'

const RETENTION_PERIOD_YEARS = 7

export interface SoftDeleteResult {
  success: boolean
  userId?: string
  error?: string
}

export interface PurgeResult {
  table: string
  recordsDeleted: number
}

/**
 * Soft delete a user and all associated records
 * This marks records as deleted but keeps them for the retention period
 */
export async function softDeleteUser(
  userId: string,
  actorUserId: string,
  actorRole: string,
  requestId?: string
): Promise<SoftDeleteResult> {
  const pool = await getPool()
  if (!pool) {
    return { success: false, error: 'Database not available' }
  }

  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    
    const deletedAt = new Date()
    
    // Soft delete user
    await client.query(
      'UPDATE users SET deleted_at = $1 WHERE id = $2',
      [deletedAt, userId]
    )
    
    // Soft delete associated records
    await client.query(
      'UPDATE wallets SET deleted_at = $1 WHERE user_id = $2',
      [deletedAt, userId]
    )
    
    await client.query(
      'UPDATE linked_addresses SET deleted_at = $1 WHERE user_id = $2',
      [deletedAt, userId]
    )
    
    await client.query(
      'UPDATE landlord_profiles SET deleted_at = $1 WHERE user_id = $2',
      [deletedAt, userId]
    )
    
    await client.query(
      'UPDATE tenant_applications SET deleted_at = $1 WHERE user_id = $2',
      [deletedAt, userId]
    )
    
    await client.query(
      'UPDATE whistleblower_listings SET deleted_at = $1 WHERE whistleblower_id = $2',
      [deletedAt, userId]
    )
    
    await client.query(
      'UPDATE tenant_deals SET deleted_at = $1 WHERE tenant_id = $2',
      [deletedAt, userId]
    )
    
    await client.query(
      'UPDATE landlord_properties SET deleted_at = $1 WHERE landlord_id = $2',
      [deletedAt, userId]
    )
    
    // Log audit event
    await client.query(
      `INSERT INTO audit_log (event_type, actor_type, actor_id, details, request_id)
       VALUES ('user_soft_deleted', 'user', $1, $2, $3)`,
      [
        actorUserId,
        JSON.stringify({ targetUserId: userId, deletedAt }),
        requestId || null
      ]
    )
    
    await client.query('COMMIT')
    
    logger.info('User soft deleted successfully', {
      userId,
      actorUserId,
      actorRole,
      requestId,
    })
    
    return { success: true, userId }
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error('Failed to soft delete user', {
      userId,
      actorUserId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { 
      success: false, 
      userId,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    client.release()
  }
}

/**
 * Purge records that have exceeded the retention period
 * This permanently deletes records that were soft deleted more than RETENTION_PERIOD_YEARS ago
 */
export async function purgeExpiredRecords(): Promise<PurgeResult[]> {
  const pool = await getPool()
  if (!pool) {
    throw new Error('Database not available')
  }

  const results: PurgeResult[] = []
  const cutoffDate = new Date()
  cutoffDate.setFullYear(cutoffDate.getFullYear() - RETENTION_PERIOD_YEARS)
  
  const tables = [
    'users',
    'sessions',
    'wallets',
    'linked_addresses',
    'landlord_profiles',
    'tenant_applications',
    'whistleblower_listings',
    'tenant_deals',
    'landlord_properties',
    'ngn_deposits',
    'conversions',
    'webhook_events',
    'webhook_replay_attempts',
    'otp_challenges',
    'wallet_challenges',
    'kyc_documents',
    'tenant_documents',
    'property_photos',
    'support_messages',
  ]
  
  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    
    for (const table of tables) {
      try {
        const result = await client.query(
          `DELETE FROM ${table} WHERE deleted_at < $1`,
          [cutoffDate]
        )
        
        const recordsDeleted = result.rowCount || 0
        
        if (recordsDeleted > 0) {
          results.push({ table, recordsDeleted })
          
          // Log audit event for each table
          await client.query(
            `INSERT INTO audit_log (event_type, actor_type, actor_id, details)
             VALUES ('data_retention_purge', 'system', 'system', $1)`,
            [JSON.stringify({ table, recordsDeleted, cutoffDate })]
          )
          
          logger.info('Purged expired records', {
            table,
            recordsDeleted,
            cutoffDate,
          })
        }
      } catch (error) {
        logger.error(`Failed to purge table ${table}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    
    await client.query('COMMIT')
    
    // Log summary
    const totalDeleted = results.reduce((sum, r) => sum + r.recordsDeleted, 0)
    logger.info('Data retention purge completed', {
      totalDeleted,
      tablesPurged: results.length,
      cutoffDate,
    })
    
    return results
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error('Failed to purge expired records', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    client.release()
  }
}

/**
 * Get count of records pending purge
 * Returns the count of soft-deleted records that will be purged
 */
export async function getPendingPurgeCount(): Promise<Record<string, number>> {
  const pool = await getPool()
  if (!pool) {
    throw new Error('Database not available')
  }

  const cutoffDate = new Date()
  cutoffDate.setFullYear(cutoffDate.getFullYear() - RETENTION_PERIOD_YEARS)
  
  const tables = [
    'users',
    'sessions',
    'wallets',
    'linked_addresses',
    'landlord_profiles',
    'tenant_applications',
    'whistleblower_listings',
    'tenant_deals',
    'landlord_properties',
    'ngn_deposits',
    'conversions',
    'webhook_events',
    'webhook_replay_attempts',
    'otp_challenges',
    'wallet_challenges',
    'kyc_documents',
    'tenant_documents',
    'property_photos',
    'support_messages',
  ]
  
  const counts: Record<string, number> = {}
  
  for (const table of tables) {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM ${table} WHERE deleted_at < $1`,
        [cutoffDate]
      )
      counts[table] = parseInt(result.rows[0].count, 10)
    } catch (error) {
      logger.error(`Failed to get pending purge count for ${table}`, {
        error: error instanceof Error ? error.message : String(error),
      })
      counts[table] = 0
    }
  }
  
  return counts
}
