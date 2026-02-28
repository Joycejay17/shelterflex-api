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
| API specification (OpenAPI) | [openapi.yml](openapi.yml) |
| Error handling contract | [src/docs/ERROR-INFO.md](src/docs/ERROR-INFO.md) |

## API Specification

The complete API specification is available in [OpenAPI format](openapi.yml). It includes:
- All available endpoints
- Request/response schemas
- Error response formats
- Example requests and responses

You can view the OpenAPI spec in tools like Swagger UI or Redoc, or use it to generate client code.

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

- `RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `RATE_LIMIT_MAX_REQUESTS` (optional, default `100`)
- `SOROBAN_RPC_URL`
- `SOROBAN_NETWORK_PASSPHRASE`
- `SOROBAN_CONTRACT_ID` (optional)


## Request IDs

Every incoming request is assigned a unique request ID to help track and debug requests across the system.

- If the client sends `x-request-id` in the request header, it is reused.
- Otherwise, a UUID is generated automatically.
- The request ID is returned in the response header (`x-request-id`).
- Error responses include the request ID in both the header and the JSON body.
- Logs include the request ID for easier correlation between requests and system logs.

Example:

Request:
GET /health
x-request-id: abc-123

Response:
HTTP/1.1 200 OK
x-request-id: abc-123
{
  "status": "ok",
  "requestId": "abc-123"
}
## Rate limiting

Public endpoints (`GET /health`, `GET /soroban/config`) are rate limited per IP to reduce abuse and protect uptime.

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Time window in milliseconds | `60000` (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per IP per window | `100` |

When a client exceeds the limit, the server responds with **429 Too Many Requests** and a JSON body in the standard error format:

```json
{
  "error": "Too many requests. Please try again later."
}
```

Defaults are suitable for local development; set lower limits in production if needed.

