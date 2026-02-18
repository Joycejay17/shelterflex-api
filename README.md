# Shelterflex Backend

Node.js backend for Shelterflex.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Endpoints

- `GET /health`
- `GET /soroban/config`

## Soroban integration

Soroban-related code should live in `src/soroban/`.

Environment variables:

- `SOROBAN_RPC_URL`
- `SOROBAN_NETWORK_PASSPHRASE`
- `SOROBAN_CONTRACT_ID` (optional)
