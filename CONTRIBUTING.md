# Contributing to Shelterflex API

Thanks for contributing! This is the **back-end API** for Shelterflex, a Rent Now, Pay
Later (RNPL) rental platform. See the [ecosystem overview](https://github.com/Shelterflex/shelterflex-platform/blob/main/ECOSYSTEM.md)
for how this repo fits with the web app and contracts.

## Ways to contribute

API design, validation, auth, persistence, deal/installment logic, risk & credit
assessment, Soroban RPC integration, observability, and monitoring.

## Ground rules

- Keep PRs small and focused — 1 issue per PR.
- Link the issue you're addressing (e.g. `Fixes #123`).
- Update the OpenAPI spec (`openapi.yml`) when you change routes.
- Add/adjust tests; keep `test-vectors.json` in sync with platform (a CI drift check enforces this).
- Never commit secrets (`.env*` files, keys, seed phrases).

## Development setup

```bash
npm ci
cp .env.example .env
npm run dev                     # http://localhost:4000
```

Postgres + MinIO are easiest via the full-stack compose in
[shelterflex-platform](https://github.com/Shelterflex/shelterflex-platform).

## Before you open a PR

```bash
npm run lint
npm run test:ci
npm run openapi:validate
```

## Working with contracts

The API calls contracts over Soroban RPC using addresses from the contracts repo's
`deployment/deployed`. Keep Soroban code under `src/soroban/`.

## Creating an issue

Use the templates under `.github/ISSUE_TEMPLATE/`. Check existing issues first.
