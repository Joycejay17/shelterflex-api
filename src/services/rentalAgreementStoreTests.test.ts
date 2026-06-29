import { describe, it, expect } from "vitest";
import { rentalAgreementStore } from "../models/rentalAgreementStore.js";
import { RentalAgreementStatus } from "../models/rentalAgreement.js";

describe("RentalAgreementStore - Document Hash Binding to Signatures", () => {
  it("stores document key for hash-based signature verification", async () => {
    const dealId = "deal-" + Date.now();
    const documentKey = `rental-agreements/${dealId}/agreement.pdf`;

    const agreement = await rentalAgreementStore.create({
      dealId,
      pdfKey: documentKey,
    });

    const fetched = await rentalAgreementStore.findById(agreement.id);
    expect(fetched?.pdfKey).toBe(documentKey);
  });

  it("recording signatures binds them to the stored document", async () => {
    const dealId = "deal-sig-" + Date.now();
    const documentKey = `rental-agreements/${dealId}/agreement.pdf`;

    const agreement = await rentalAgreementStore.create({
      dealId,
      pdfKey: documentKey,
    });

    const withSignature = await rentalAgreementStore.recordSignature(
      agreement.id,
      "tenant",
      { signatureHash: "abc123" },
    );

    expect(withSignature?.pdfKey).toBe(documentKey);
    expect(withSignature?.tenantSignedAt).toBeDefined();
    expect(withSignature?.tenantSignatureData).toEqual({
      signatureHash: "abc123",
    });
  });

  it("both signatures are bound to the same document", async () => {
    const dealId = "deal-both-" + Date.now();
    const documentKey = `rental-agreements/${dealId}/final-agreement.pdf`;

    const agreement = await rentalAgreementStore.create({
      dealId,
      pdfKey: documentKey,
    });

    await rentalAgreementStore.recordSignature(agreement.id, "tenant", {});
    const finalAgreement = await rentalAgreementStore.recordSignature(
      agreement.id,
      "landlord",
      {},
    );

    expect(finalAgreement?.pdfKey).toBe(documentKey);
    expect(finalAgreement?.tenantSignedAt).toBeDefined();
    expect(finalAgreement?.landlordSignedAt).toBeDefined();
  });

  it("status transitions track agreement lifecycle", async () => {
    const dealId = "deal-status-" + Date.now();

    const draft = await rentalAgreementStore.create({
      dealId,
      pdfKey: `rental-agreements/${dealId}/draft.pdf`,
    });

    expect(draft.status).toBe(RentalAgreementStatus.DRAFT);

    const pending = await rentalAgreementStore.updateStatus(
      draft.id,
      RentalAgreementStatus.PENDING_SIGNATURES,
    );

    expect(pending?.status).toBe(RentalAgreementStatus.PENDING_SIGNATURES);

    const executed = await rentalAgreementStore.updateStatus(
      draft.id,
      RentalAgreementStatus.FULLY_EXECUTED,
    );

    expect(executed?.status).toBe(RentalAgreementStatus.FULLY_EXECUTED);
  });

  it("prevents stale documents by checking deal ID on retrieval", async () => {
    const dealId = "deal-stale-" + Date.now();

    const agreement1 = await rentalAgreementStore.create({
      dealId,
      pdfKey: `rental-agreements/${dealId}/v1.pdf`,
    });

    const agreement2 = await rentalAgreementStore.create({
      dealId: dealId + "-v2",
      pdfKey: `rental-agreements/${dealId}-v2/v2.pdf`,
    });

    const fetch1 = await rentalAgreementStore.findById(agreement1.id);
    const fetch2 = await rentalAgreementStore.findById(agreement2.id);

    expect(fetch1?.pdfKey).not.toBe(fetch2?.pdfKey);
    expect(fetch1?.dealId).not.toBe(fetch2?.dealId);
  });

  it("finds most recent agreement by deal ID for lookup", async () => {
    const dealId = "deal-lookup-" + Date.now();

    const first = await rentalAgreementStore.create({
      dealId,
      pdfKey: `rental-agreements/${dealId}/v1.pdf`,
    });

    const found = await rentalAgreementStore.findByDealId(dealId);
    expect(found?.id).toBe(first.id);
  });

  it("agreement document key is immutable once created", async () => {
    const dealId = "deal-immutable-" + Date.now();
    const originalKey = `rental-agreements/${dealId}/immutable.pdf`;

    const agreement = await rentalAgreementStore.create({
      dealId,
      pdfKey: originalKey,
    });

    // Even after status changes, document key remains same
    await rentalAgreementStore.updateStatus(
      agreement.id,
      RentalAgreementStatus.PENDING_SIGNATURES,
    );

    const unchanged = await rentalAgreementStore.findById(agreement.id);
    expect(unchanged?.pdfKey).toBe(originalKey);
  });

  it("complete lifecycle: draft -> pending -> signed -> executed", async () => {
    const dealId = "deal-lifecycle-" + Date.now();
    const docKey = `rental-agreements/${dealId}/complete.pdf`;

    const draft = await rentalAgreementStore.create({
      dealId,
      pdfKey: docKey,
    });

    const pending = await rentalAgreementStore.updateStatus(
      draft.id,
      RentalAgreementStatus.PENDING_SIGNATURES,
    );

    const tenantSigned = await rentalAgreementStore.recordSignature(
      pending!.id,
      "tenant",
      { timestamp: Date.now() },
    );

    const landlordSigned = await rentalAgreementStore.recordSignature(
      tenantSigned!.id,
      "landlord",
      { timestamp: Date.now() },
    );

    const executed = await rentalAgreementStore.updateStatus(
      landlordSigned!.id,
      RentalAgreementStatus.FULLY_EXECUTED,
    );

    expect(executed?.status).toBe(RentalAgreementStatus.FULLY_EXECUTED);
    expect(executed?.pdfKey).toBe(docKey);
    expect(executed?.tenantSignedAt).toBeDefined();
    expect(executed?.landlordSignedAt).toBeDefined();
  });
});
