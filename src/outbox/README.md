# Outbox Pattern for Reliable Chain Writes

This module implements the outbox pattern to ensure exactly-once delivery of receipts to the blockchain, preventing data loss from network failures or RPC downtime.

## Architecture

### Components

1. **Store** (`store.ts`) - In-memory storage for outbox items (designed for easy DB migration)
2. **Canonicalization** (`canonicalization.ts`) - Deterministic tx_id computation for idempotency
3. **Sender** (`sender.ts`) - Handles sending transactions to the blockchain with retry logic
4. **Types** (`types.ts`) - TypeScript types and enums

### Flow

```
POST /api/payments/confirm
  ↓
1. Validate request
  ↓
2. Compute tx_id (deterministic, based on external ref + payload)
  ↓
3. Create/retrieve outbox item (idempotent)
  ↓
4. Attempt immediate send
  ↓
5a. Success → Mark as SENT
5b. Failure → Mark as FAILED, keep for retry
```

## Canonicalization Rules

Transaction IDs are computed deterministically to ensure idempotency:

1. **Normalize external reference**: Lowercase source prefix, preserve ID case
   - `STRIPE:pi_123` → `stripe:pi_123`
   - `Manual:2024-01-15` → `manual:2024-01-15`

2. **Sort payload keys**: Ensures consistent hashing regardless of key order
   ```json
   { "amount": "1000", "dealId": "deal-001" }
   { "dealId": "deal-001", "amount": "1000" }
   // Both produce the same tx_id
   ```

3. **Compute SHA-256 hash**: Generate 32-byte hash as hex string (64 characters)

### External Reference Format

Format: `{source}:{id}`

Examples:
- `stripe:pi_abc123` - Stripe payment intent
- `manual:2024-01-15-tenant-001` - Manual payment entry
- `paypal:PAYID-ABC123` - PayPal transaction

## API Endpoints

### Payment Confirmation

**POST /api/payments/confirm**

Confirm an off-chain payment and queue on-chain receipt.

Request:
```json
{
  "externalRef": "stripe:pi_abc123",
  "dealId": "deal-001",
  "amount": "1000",
  "payer": "GABC123..."
}
```

Response (200 - immediate success):
```json
{
  "success": true,
  "outboxId": "uuid",
  "txId": "64-char-hex",
  "status": "sent",
  "message": "Payment confirmed and receipt written to chain"
}
```

Response (202 - queued for retry):
```json
{
  "success": true,
  "outboxId": "uuid",
  "txId": "64-char-hex",
  "status": "pending",
  "message": "Payment confirmed, receipt queued for retry"
}
```

### Admin Endpoints

**GET /api/admin/outbox?status={pending|sent|failed}&limit={number}**

List outbox items, optionally filtered by status.

Response:
```json
{
  "items": [
    {
      "id": "uuid",
      "txType": "receipt",
      "txId": "64-char-hex",
      "externalRef": "stripe:pi_abc123",
      "status": "failed",
      "attempts": 3,
      "lastError": "Network timeout",
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:05:00Z",
      "payload": { ... }
    }
  ],
  "total": 1
}
```

**POST /api/admin/outbox/:id/retry**

Retry a specific failed outbox item.

Response:
```json
{
  "success": true,
  "item": {
    "id": "uuid",
    "txId": "64-char-hex",
    "status": "sent",
    "attempts": 4,
    "updatedAt": "2024-01-15T10:10:00Z"
  },
  "message": "Retry successful, receipt written to chain"
}
```

**POST /api/admin/outbox/retry-all**

Retry all failed outbox items.

Response:
```json
{
  "success": true,
  "succeeded": 5,
  "failed": 2,
  "message": "Retried 7 items: 5 succeeded, 2 failed"
}
```

## Idempotency Guarantees

1. **Application Level**: Duplicate external references return the same outbox item
2. **Contract Level**: Duplicate tx_id values are rejected by the smart contract
3. **Retry Safety**: Retries never create duplicate receipts

## Testing

### Unit Tests

```bash
npm test outbox.test.ts
```

Tests cover:
- Outbox item creation and retrieval
- Idempotency for duplicate external references
- Status updates and attempt tracking
- Canonicalization rules and deterministic tx_id generation
- External reference validation

### Integration Tests

```bash
npm test payments.test.ts
```

Tests cover:
- Payment confirmation endpoint
- Validation and error handling
- Idempotency across API calls

### Manual Testing

1. **Simulate failure scenario**:
   ```bash
   # Confirm payment (may fail randomly due to 10% simulated failure rate)
   curl -X POST http://localhost:4000/api/payments/confirm \
     -H "Content-Type: application/json" \
     -d '{
       "externalRef": "test:payment-001",
       "dealId": "deal-001",
       "amount": "1000",
       "payer": "GABC123"
     }'
   ```

2. **Check outbox status**:
   ```bash
   curl http://localhost:4000/api/admin/outbox?status=failed
   ```

3. **Retry failed item**:
   ```bash
   curl -X POST http://localhost:4000/api/admin/outbox/{id}/retry
   ```

4. **Retry all failed**:
   ```bash
   curl -X POST http://localhost:4000/api/admin/outbox/retry-all
   ```

## Future Enhancements

### Database Persistence

Replace in-memory store with database:

```typescript
// Example with PostgreSQL
class DatabaseOutboxStore implements OutboxStore {
  async create(input: CreateOutboxItemInput): Promise<OutboxItem> {
    // INSERT INTO outbox_items ...
    // ON CONFLICT (canonical_external_ref_v1) DO NOTHING
  }
  
  async listByStatus(status: OutboxStatus): Promise<OutboxItem[]> {
    // SELECT * FROM outbox_items WHERE status = $1
  }
  
  // ... other methods
}
```

### Background Worker

Add a background worker for automatic retries:

```typescript
class OutboxWorker {
  async start() {
    setInterval(async () => {
      const failed = await outboxStore.listByStatus(OutboxStatus.FAILED)
      for (const item of failed) {
        if (this.shouldRetry(item)) {
          await sender.retry(item.id)
        }
      }
    }, 60000) // Every minute
  }
  
  private shouldRetry(item: OutboxItem): boolean {
    // Exponential backoff logic
    const backoffMs = Math.pow(2, item.attempts) * 1000
    const elapsed = Date.now() - item.updatedAt.getTime()
    return elapsed >= backoffMs
  }
}
```

### Monitoring & Alerts

- Track outbox item age
- Alert on items stuck in FAILED state
- Metrics: success rate, retry count, latency

### Dead Letter Queue

Move items to DLQ after max retry attempts:

```typescript
const MAX_ATTEMPTS = 10

if (item.attempts >= MAX_ATTEMPTS) {
  await deadLetterQueue.add(item)
  await outboxStore.delete(item.id)
}
```

## References

- [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [Exactly-Once Delivery](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- Contracts Transaction Ledger (Issue #1)
