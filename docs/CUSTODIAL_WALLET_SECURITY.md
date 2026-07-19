# Custodial Wallet Security Architecture

## 1. Overview

This document defines the **threat model, security controls, and incident response procedures** for the custodial wallet system.

The wallet consists of:

* Backend signing service
* KMS-managed master keys
* Encrypted key database
* Redis session store
* Soroban smart contracts (Rust)
* Stellar account-level signers

This document is operational and actionable.

---

# 2. System Architecture (High-Level)

```
User → API → Signing Service → KMS → Stellar Network
                  ↓
                Database (Encrypted Keys)
                  ↓
               Audit Logs
```

Critical trust boundaries:

1. API Layer
2. Signing Service
3. Database
4. Key Management System (KMS)
5. Smart Contract (Pause Switch)

---

# 3. Threat Model

## 3.1 Database Leak

### Scenario

Attacker gains read access to the production database.

### Risk

* Exposure of encrypted private keys
* Exposure of user metadata
* Replay attempts

### Mitigations

* Envelope encryption (DEK + KEK model)
* No plaintext keys stored
* No secrets stored in logs
* Strict DB network isolation
* Row-level access policies

---

## 3.2 Server Compromise

### Scenario

Attacker gains shell access to signing server.

### Risk

* Memory scraping
* Unauthorized transaction signing
* KMS misuse

### Mitigations

* Signing controlled via `SIGNING_ENABLED` flag
* KMS IAM role restriction
* mTLS between services
* No local master key storage
* Short-lived JWT sessions
* Memory zeroization (`zeroize` crate)

---

## 3.3 Insider Risk

### Scenario

Authorized engineer misuses access.

### Risk

* Direct signing
* Key extraction attempts
* Log tampering

### Mitigations

* RBAC (no shared admin accounts)
* Mandatory MFA
* KMS access scoped to service account only
* Audit logs immutable (WORM bucket)
* Dual control for key rotation

---

## 3.4 Log Leakage

### Scenario

Sensitive data accidentally logged.

### Risk

* JWT tokens exposed
* Key fragments leaked
* Transaction preimages leaked

### Mitigations

* Structured logging with redaction
* No request body logging
* Log retention < 30 days
* Secret scanning in CI

---

## 3.5 Replay Attacks

### Scenario

Valid signed transaction replayed.

### Mitigations

* Network passphrase validation
* Soroban `require_auth`
* Sequence number enforcement
* TTL expiration monitoring

---

# 4. Security Controls

---

## 4.1 Encryption at Rest (Envelope Model)

Architecture:

```
User Key → Encrypted with DEK
DEK → Encrypted with KMS KEK
```

### Controls

* Master Key (KEK) stored in AWS/GCP KMS
* DEKs generated per wallet
* AES-256-GCM encryption
* DEKs never stored plaintext
* All key structs implement `Zeroize`

### Envelope Format (Persisted Encrypted Secret Key)

The backend persists custodial wallet secret keys as a **base64-encoded UTF-8 JSON envelope**.

Storage representation:

```
encryptedSecretKey = base64(utf8(JSON.stringify(envelope)))
```

Envelope JSON (versioned):

```json
{
  "version": 1,
  "iv": "<base64-encoded 12-byte nonce>",
  "authTag": "<base64-encoded 16-byte GCM auth tag>",
  "ciphertext": "<base64-encoded ciphertext bytes>"
}
```

Notes:

* `version` allows future envelope upgrades without ambiguity.
* Any modification to `iv`, `authTag`, or `ciphertext` must cause decryption to fail.
* The `keyId` stored alongside the envelope identifies which master key material/version was used, to support rotation.

### Required Env Vars

| Variable                     | Purpose          |
| ---------------------------- | ---------------- |
| `KMS_KEY_ID`                 | ID of master key |
| `ENCRYPTION_ALGORITHM`       | AES-256-GCM      |
| `KEY_ROTATION_INTERVAL_DAYS` | e.g. 90          |

---

## 4.2 Access Controls

* IAM role attached to signing service
* No static cloud credentials
* Admin functions require on-chain `require_auth`
* Production access via bastion host only
* Database access restricted to VPC

---

## 4.3 Audit Logging

### On-Chain

* Every transfer emits event
* Indexed by backend watcher

### Off-Chain

Audit logs must include:

* Timestamp
* User ID
* Wallet ID
* Tx Hash
* IP Address
* Request ID

Logs stored in:

* Immutable storage bucket
* Retention: 1 year minimum

---

## 4.4 Key Rotation

### Automatic Rotation

* DEK rotation: every 90 days
* KEK rotation: annually via KMS

### Signing Key Rotation (Automated State Machine)

The signing key rotation is managed by `SigningKeyRotationService` which implements a crash-safe, overlapping dual-key validity state machine.

#### State Machine

The rotation progresses through these durable, idempotent states:

1. **new_key_provisioned** - New key pair generated and stored securely
2. **new_key_authorized_on_chain** - New signer added to Stellar account (dual-key window starts)
3. **active_pointer_cutover** - Atomic switch to use new key for signing
4. **old_key_deauthorized_on_chain** - Old signer removed from Stellar account (dual-key window ends)
5. **old_key_destroyed** - Old key material securely destroyed
6. **completed** - Rotation finished successfully
7. **failed** - Rotation failed with reason (requires manual intervention)

#### Key Guarantees

- **Zero-valid-signer window prevention**: At least one valid signer exists at every instant (add-before-remove ordering)
- **In-flight transaction safety**: Transactions signed with old key before cutover can still confirm during dual-key window
- **Crash safety**: Each state is durable; crash at any point resumes deterministically
- **Atomic cutover**: Active-key pointer switch is atomic in the database
- **Secure destruction**: Retired key material is securely destroyed and fully audit-logged
- **Sequence coordination**: Works with `StellarSequenceAllocator` to prevent stranded sequences

#### Usage

```typescript
import { getSigningKeyRotationService } from '../services/signingKeyRotationService.js'

const rotationService = getSigningKeyRotationService()

// Start a new rotation
const result = await rotationService.startRotation({
  keyType: 'admin',
  accountAddress: 'G...',
  initiatedBy: 'admin-user-id',
})

// Advance to next state (call repeatedly until completed)
const advanced = await rotationService.advanceRotation(result.rotationId)
```

#### Integration with Signing Services

`AdminSigningService` automatically respects rotation state by querying `getActiveKey()` before signing. If a rotation is in progress, it uses the active key pointer; otherwise, it falls back to the configured environment variable.

#### Audit Logging

All rotation events are logged to the `audit_log` column in `signing_key_rotations` table with:
- Timestamp
- Event type (state transition)
- Relevant details (key IDs, public keys, transaction hashes)

#### Manual Rotation Procedure (Legacy)

For wallet encryption keys (DEK/KEK):

1. Generate new DEK
2. Re-encrypt private key
3. Update DB record
4. Verify decrypt works
5. Securely delete old DEK

---

## 4.5 Signing Pause Switch

Two-level protection:

### 1. Backend Flag

```
SIGNING_ENABLED=false
```

Blocks all new signing requests.

### 2. On-Chain Pause

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ADMIN_SECRET> \
  --network <network> \
  -- pause
```

Both must be activated during major incident.

---

# 5. Incident Response Runbooks

---

# 5.1 Incident: Suspected DB Leak

### Immediate Actions

1. Set `SIGNING_ENABLED=false`
2. Rotate KMS KEK
3. Force DEK re-encryption batch job
4. Invalidate all sessions
5. Enable enhanced logging

### Follow-up

* Run audit trail comparison of last 30 days
* Notify affected users within 24 hours
* Publish incident report within 72 hours

---

# 5.2 Incident: Signing Server Compromised

### Immediate Actions

1. Pause signing (backend)
2. Invoke on-chain `pause`
3. Rotate IAM credentials
4. Redeploy clean infrastructure from IaC
5. Rotate Stellar account signers

### Verification

* Compare signed tx hashes vs expected DB intents
* Confirm no unauthorized transfers

---

# 5.3 Incident: Master Key Compromise

### CRITICAL SEVERITY

### Steps

1. Pause signing
2. Create new KMS key
3. Re-encrypt ALL DEKs
4. Rotate Stellar account master key via `set_options`
5. Invalidate all JWT sessions
6. Require user password reset

---

# 5.4 Session Invalidation Procedure

1. Flush Redis
2. Rotate JWT signing secret
3. Force logout across all devices
4. Set `TOKEN_VERSION++` in DB

---

# 6. Operational Environment Variables

| Variable                     | Required | Description                   |
| ---------------------------- | -------- | ----------------------------- |
| `SIGNING_ENABLED`            | Yes      | Global signing kill switch    |
| `KMS_KEY_ID`                 | Yes      | Master encryption key         |
| `JWT_SECRET`                 | Yes      | Token signing secret          |
| `SOROBAN_NETWORK_PASSPHRASE` | Yes      | Prevent cross-network signing |
| `SOROBAN_RPC_URL`            | Yes      | RPC endpoint                  |
| `MIN_TTL_THRESHOLD`          | Yes      | Storage monitoring            |
| `AUDIT_LOG_BUCKET`           | Yes      | Immutable audit storage       |
| `REDIS_URL`                  | Yes      | Session store                 |

---

# 7. Monitoring & Alerting

Alert triggers:

* > 3 failed KMS decrypts
* Signing volume anomaly
* Unexpected admin pause
* Elevated 5xx errors
* TTL threshold breach

---

# 8. User Communication Template

**Subject:** Security Update Regarding Your Wallet

Dear User,

We detected a security anomaly in our custodial signing infrastructure.

### Immediate Actions Taken

* Signing services paused
* Smart contract pause activated
* Keys rotated
* Sessions invalidated

### What This Means

Your funds remain secured on-chain. No unauthorized transfers have been detected at this time.

### What You Should Do

* Re-login to your account
* Reset your password

We will provide a full transparency report within 72 hours.

---

# 9. Security Review Checklist

* [ ] Encryption verified
* [ ] KEK rotation tested
* [ ] Incident runbook rehearsed
* [ ] Logging redaction verified
* [ ] Pause switch tested quarterly
* [ ] Backup restore tested
