## Error handling

Every error response from this API uses the same JSON contract:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": { "field": "per-field message" }
  }
}
```

`details` is only present when there is extra context (e.g. field-level validation errors).

### Error codes

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body / query / params failed Zod validation, or malformed JSON |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated but lacks permission |
| `NOT_FOUND` | 404 | Resource or route does not exist |
| `CONFLICT` | 409 | Resource already exists |
| `SOROBAN_ERROR` | 502 | Upstream Soroban RPC call failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Examples

**Validation error – 400**

Triggered by the `validate` middleware or a `ZodError` thrown in a handler.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {
      "email": "Invalid email",
      "amount": "Expected number, received string"
    }
  }
}
```

**Not found – 404**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Property not found"
  }
}
```

**Internal error – 500**

Stack trace and internal details are never exposed to the client.

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

### Throwing errors in route handlers

```ts
import { notFound, forbidden, sorobanError } from '../errors/index.js'

// Use factories for common cases
throw notFound('Property')
throw forbidden()
throw sorobanError('RPC node unreachable', { rpcUrl: env.SOROBAN_RPC_URL })

// Or construct directly for custom codes
import { AppError, ErrorCode } from '../errors/index.js'
throw new AppError(ErrorCode.CONFLICT, 409, 'Wallet address already registered')
```

### Test endpoints (non-production only)

| Method | Path | Triggers |
|--------|------|----------|
| `GET` | `/test/validation` | `VALIDATION_ERROR` 400 |
| `GET` | `/test/not-found` | `NOT_FOUND` 404 |
| `GET` | `/test/crash` | `INTERNAL_ERROR` 500 |