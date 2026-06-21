import { describe, expect, it } from 'vitest'
import { StrKey } from '@stellar/stellar-sdk'
import {
  CONTRACT_ENV_VARS,
  loadContractAddresses,
} from './contractAddresses.js'

const VALID_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'

describe('contract address config', () => {
  it('loads valid addresses into a typed object and records unset entries', () => {
    expect(StrKey.isValidContract(VALID_CONTRACT_ID)).toBe(true)
    const addresses = loadContractAddresses({
      SOROBAN_DEAL_ESCROW_ID: VALID_CONTRACT_ID,
    })

    expect(addresses.dealEscrow).toBe(VALID_CONTRACT_ID)
    expect(addresses.rentPayments).toBeUndefined()
    expect(Object.keys(addresses)).toEqual(Object.keys(CONTRACT_ENV_VARS))
  })

  it('fails fast with the offending environment variable', () => {
    expect(() =>
      loadContractAddresses({
        SOROBAN_TENANT_REPUTATION_ID: 'not-a-contract',
      }),
    ).toThrow(
      'Invalid Soroban contract ID in SOROBAN_TENANT_REPUTATION_ID',
    )
  })
})

