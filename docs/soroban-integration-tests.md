# Soroban Integration Tests

This document describes how to run the Soroban integration tests for the RealSorobanAdapter.

## Overview

The integration tests are designed to validate that the RealSorobanAdapter can correctly interact with Soroban contracts on the testnet. These tests make actual network calls and require proper configuration.

## Environment Setup

### Required Environment Variables

The integration tests require the following environment variables to be set:

```bash
# Soroban network configuration
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Contract IDs (must be deployed to Soroban testnet)
SOROBAN_CONTRACT_ID=your_contract_id_here
SOROBAN_USDC_TOKEN_ID=your_usdc_token_contract_id_here

# Admin secret key for signing transactions
SOROBAN_ADMIN_SECRET=your_admin_secret_key_here

# Optional variables for staking tests
SOROBAN_STAKING_POOL_ID=your_staking_pool_id_here
SOROBAN_STAKING_REWARDS_ID=your_staking_rewards_id_here
```

### Configuration File

Create a `.env` file in the backend directory with the required variables:

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your actual values
```

## Running Tests

### Manual Execution

To run the integration tests manually:

```bash
# Set the environment variable and run tests
export SOROBAN_INTEGRATION_TESTS=true
npm run test:integration
```

Or on Windows:
```cmd
set SOROBAN_INTEGRATION_TESTS=true
npm run test:integration
```

### Using npm Scripts

The project includes convenient npm scripts:

```bash
# Run integration tests once
npm run test:integration

# Run integration tests in watch mode
npm run test:integration:watch
```

### CI/CD Integration

For CI/CD pipelines, ensure the required environment variables are set as secrets, then run:

```bash
SOROBAN_INTEGRATION_TESTS=true npm run test:integration
```

## Test Coverage

The integration tests cover the following scenarios:

### 1. recordReceipt Tests
- **New Transaction**: Successfully records a new receipt with a unique txId
- **Idempotency**: Handles duplicate txIds gracefully (should not fail)
- **Configuration Validation**: Validates required configuration is present

### 2. getBalance Tests
- **Valid Account**: Retrieves balance for a funded account
- **Unfunded Account**: Returns meaningful error for non-existent accounts
- **Configuration Validation**: Validates USDC token contract ID is configured

### 3. Network Connectivity
- **RPC Connection**: Validates connectivity to Soroban RPC endpoint
- **Network Errors**: Provides actionable error messages for network issues

## Test Data

### Test Accounts
The tests use well-known testnet accounts:
- `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF` - Stellar testnet faucet account

### Test Transactions
- Generates unique txIds using timestamps and random values
- Uses realistic USDC amounts (e.g., "100.50", "200.00")
- Tests different transaction types (TENANT_REPAYMENT, LANDLORD_PAYOUT)

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   ```
   Error: Missing required environment variables for integration tests: SOROBAN_CONTRACT_ID, SOROBAN_USDC_TOKEN_ID
   ```
   **Solution**: Ensure all required environment variables are set in your `.env` file.

2. **Network Connectivity Issues**
   ```
   Error: Network connectivity test failed: econnrefused
   ```
   **Solution**: Check your internet connection and verify the RPC URL is correct.

3. **Contract Not Found**
   ```
   Error: Failed to get USDC balance for GABC123
   ```
   **Solution**: Verify the contract IDs are correct and deployed to the testnet.

4. **Invalid Admin Secret**
   ```
   Error: Invalid admin secret key configured
   ```
   **Solution**: Ensure the admin secret key is a valid Stellar secret key.

### Debug Mode

For additional debugging information, you can run the tests with increased logging:

```bash
DEBUG=* SOROBAN_INTEGRATION_TESTS=true npm run test:integration
```

### Test Timeouts

If tests are timing out, you may need to increase the timeout values in the test file or check network connectivity. The default timeouts are:
- recordReceipt tests: 30-45 seconds
- getBalance tests: 20 seconds
- Network connectivity tests: 15 seconds

## Security Considerations

- **Never commit actual secret keys or contract IDs to version control**
- **Use environment variables or secret management systems**
- **Use testnet accounts and contracts only**
- **Rotate admin keys regularly in production**

## Contributing

When adding new integration tests:

1. Follow the existing pattern of using `describe.skipIf(!runIntegrationTests)`
2. Include proper error handling and meaningful assertions
3. Add appropriate timeouts for network operations
4. Update this documentation with any new requirements

## CI Configuration

For GitHub Actions or other CI systems:

```yaml
- name: Run Soroban Integration Tests
  run: npm run test:integration
  env:
    SOROBAN_INTEGRATION_TESTS: true
    SOROBAN_RPC_URL: ${{ secrets.SOROBAN_RPC_URL }}
    SOROBAN_CONTRACT_ID: ${{ secrets.SOROBAN_CONTRACT_ID }}
    SOROBAN_USDC_TOKEN_ID: ${{ secrets.SOROBAN_USDC_TOKEN_ID }}
    SOROBAN_ADMIN_SECRET: ${{ secrets.SOROBAN_ADMIN_SECRET }}
    SOROBAN_NETWORK_PASSPHRASE: ${{ secrets.SOROBAN_NETWORK_PASSPHRASE }}
```

Make the integration test step optional in CI by using a condition or allowing it to fail without blocking the build.
