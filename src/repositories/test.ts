
import { pool } from "../db.js";
import { OutboxItem, OutboxItemInsert } from "../outbox/types.js";

export class OutboxRepository {
  // Insert a new outbox event
  async add(item: OutboxItemInsert) {
    await pool.query(
      `INSERT INTO outbox_items (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,$2,$3,$4)`,
      [item.aggregateType, item.aggregateId, item.eventType, item.payload]
    );
  }

  // Fetch pending events
  async fetchPending(): Promise<OutboxItem[]> {
    const { rows } = await pool.query(`
      SELECT
        id,
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        event_type AS "eventType",
        payload,
        status,
        retry_count AS "retryCount",
        next_retry_at AS "nextRetryAt",
        created_at AS "createdAt",
        processed_at AS "processedAt"
      FROM outbox_items
      WHERE status='PENDING' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);
    return rows;
  }

  async markProcessed(id: string) {
    await pool.query(
      `UPDATE outbox_items SET status='PROCESSED', processed_at=NOW() WHERE id=$1`,
      [id]
    );
  }

  async markRetry(id: string) {
    await pool.query(
      `UPDATE outbox_items
       SET retry_count = retry_count+1,
           next_retry_at = NOW() + INTERVAL '5 minutes'
       WHERE id=$1`,
      [id]
    );
  }
}


// --- Test Execution ---
const repo = new OutboxRepository();

async function runTest() {
  console.log(" Starting Outbox Test...");

  try {
    const items = await repo.fetchPending();
    console.log(` Connection successful! Found ${items.length} pending items.`);

    if (items.length > 0) {
      console.table(items);
    }
  } catch (error) {
    console.error(" Database Error:", error);
  } finally {
    process.exit();
  }
}

runTest();