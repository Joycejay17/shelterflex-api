# API Performance Baselines & Load Testing Suite

This directory contains the **k6-based performance and load testing suite** for the Shelterflex backend API. The suite is designed to simulate realistic user scenarios under various load profiles, validating performance thresholds (SLOs) and catching regression patterns before deployment.

---

## 📂 Directory Layout

```tree
load-tests/
├── README.md               # ← You are here
├── config.js               # Shared options, headers, and SLO thresholds
├── baselines/              # Reference JSON results for performance comparison
│   └── .gitkeep
└── scenarios/              # Individual scenario scripts
    ├── auth-otp.js         # Rate-limiting / OTP request bursting (50 VUs)
    ├── payment-flow.js     # Multi-step payment creation flow (50 VUs)
    ├── property-search.js  # Concurrent tenant search and filters (100 VUs)
    ├── staking-read.js     # Cacheable read concurrency (200 VUs)
    └── underwriting.js     # CPU-intensive screening & polling (30 VUs)
```

---

## 🛠️ Prerequisites

To run these tests, you must have **k6** installed on your machine.

### Installation Options

- **macOS (Homebrew):**
  ```bash
  brew install k6
  ```

- **Linux (Debian/Ubuntu):**
  ```bash
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD194E22E7CDA9B78A674822B78533BA195651
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.solidproject.org/apt stable main" | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update
  sudo apt-get install k6
  ```

- **Docker:**
  ```bash
  docker pull grafana/k6
  ```

---

## 🚀 How to Run the Tests

Always run k6 scripts from the **monorepo root** directory.

### 1. Running Locally (Against `localhost:4000`)

Start your local backend server, then execute any scenario:

```bash
# Run property search scenario
k6 run load-tests/scenarios/property-search.js

# Run underwriting scenario
k6 run load-tests/scenarios/underwriting.js
```

### 2. Targeting Different Environments

Use environment variables via the `-e` flag to override default configurations:

```bash
# Target staging with a specific Auth Token
k6 run \
  -e BASE_URL="https://api.staging.shelterflex.com" \
  -e AUTH_TOKEN="your-secret-staging-token" \
  -e ENVIRONMENT="staging" \
  load-tests/scenarios/payment-flow.js
```

---

## ⚙️ Environment Variables

The following environment variables can be provided to k6:

| Variable | Description | Default |
|---|---|---|
| `BASE_URL` | The target API host address under test. | `http://localhost:4000` |
| `AUTH_TOKEN` | Bearer token used for authenticated requests. | `test-token` |
| `ENVIRONMENT` | Target environment identifier (e.g. `local`, `staging`). | `local` |

---

## 📈 Service Level Objectives (SLOs) & Thresholds

Performance criteria are configured in `load-tests/config.js` and applied globally:

1. **Transaction Time (SLO):** 95% of requests (`p(95)`) must resolve in **under 500 ms**.
2. **Error Budget:** Less than **1%** (`rate < 0.01`) of all requests may fail.

*Exceptions:*
- **Underwriting:** A strict `p(99) < 2000ms` (99th percentile < 2 seconds) is enforced due to the CPU-intensive nature of background screenings.
- **Staking Reads:** Highly optimized cacheable reads require `p(95) < 200ms` and `p(99) < 400ms`.
- **Auth OTP:** Up to 50% rate limiting (429 Status) is expected and allowed during peak burst phases (no 500 Internal Server Errors are tolerated).

---

## 📊 Generating Performance Baselines & Reports

To export structured performance metrics for CI verification or baseline matching:

```bash
# Run a scenario and export results as JSON
k6 run --out json=load-tests/baselines/property-search-results.json load-tests/scenarios/property-search.js
```

You can commit files in the `baselines/` directory as performance references to detect response-time inflation over time.

---

## 🤖 CI/CD Integration

We support triggering performance suites on demand in GitHub Actions via the `.github/workflows/load-test.yml` workflow.

### Trigger Options
- **Environment:** Select `staging` or `production-readonly`.
- **Scenario:** Select `all` or target a specific scenario (`property-search`, `payment-flow`, etc.).

If any performance thresholds are breached (e.g. `p(95) > 500ms` or error rate exceeds `1%`), **k6 will exit with a non-zero code and automatically fail the build**, blocking regressions from reaching production.
