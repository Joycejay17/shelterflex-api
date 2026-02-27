# Shelterflex Backend

Node.js backend for Shelterflex.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Documentation

| Topic | File |
|---|---|
| Endpoints & request validation | this file |
| Error handling contract | [src/docs/ERROR-INFO.md](src/docs/ERROR-INFO.md) |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service liveness check |
| `GET` | `/soroban/config` | Returns the active Soroban RPC configuration |
| `POST` | `/soroban/simulate` | Validates and queues a Soroban contract simulation |

### POST `/soroban/simulate`

Validates the request body with Zod before forwarding to the Soroban RPC node.
Returns **400** with structured field-level errors on invalid input.

**Request body**

```json
{
  "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "method": "deposit",
  "args": [1000, "GABC..."]
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `contractId` | `string` | ✅ | Exactly 56 characters (Stellar strkey) |
| `method` | `string` | ✅ | Non-empty string |
| `args` | `unknown[]` | ❌ | Defaults to `[]` |

**Success – 200**

```json
{
  "contractId": "CAAA...",
  "method": "deposit",
  "args": [1000, "GABC..."],
  "status": "pending",
  "message": "Simulation queued – RPC integration coming soon"
}
```

**Validation error – 400**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {
      "contractId": "contractId must be a 56-character Stellar strkey"
    }
  }
}
```

## Request validation pattern

All endpoints that accept input use the `validate` middleware from
`src/middleware/validate.ts`. It wraps any Zod schema and can target
`body` (default), `query`, or `params`:

```ts
import { validate } from './middleware/validate.js'
import { mySchema } from './schemas/my-feature.js'

// validate body (default)
router.post('/route', validate(mySchema), handler)

// validate query string
router.get('/route', validate(mySchema, 'query'), handler)
```

Schemas live in `src/schemas/` and export both the Zod schema and the
inferred TypeScript type.

## Error handling

See [src/docs/ERROR-INFO.md](src/docs/ERROR-INFO.md) for the full error contract, code catalog, and usage examples.

## Soroban integration

Soroban-related code should live in `src/soroban/`.

Environment variables:

- `SOROBAN_RPC_URL`
- `SOROBAN_NETWORK_PASSPHRASE`
- `SOROBAN_CONTRACT_ID` (optional)
