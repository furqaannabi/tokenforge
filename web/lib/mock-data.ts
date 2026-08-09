/**
 * Demo fixtures. Sample documents and mock loans on testnet — no real
 * counterparty, no real money, no legal effect.
 *
 * The document bodies matter: every `sourceQuote` below appears verbatim in the
 * corresponding document text, which is what lets the review pane highlight the
 * exact span a field was extracted from.
 */

import type { Issuer, Note, PaymentPeriod } from "./types";

/**
 * Interest-only note with a bullet principal repayment at maturity — the
 * structure all three demo documents use.
 */
function interestOnlySchedule(
  dueDates: string[],
  principal: number,
  coupon: number,
): PaymentPeriod[] {
  return dueDates.map((dueDate, i) => ({
    index: i + 1,
    dueDate,
    principal: i === dueDates.length - 1 ? principal : 0,
    interest: coupon,
  }));
}

export const MERIDIAN: Issuer = {
  name: "Meridian Freight Holdings LLC",
  address: "0x7A4F1c9E2b8D3a5F6c1E9B0d4A2c8F3e5D7b1A9c",
  verified: true,
  jurisdiction: "Delaware, USA",
};

export const HALCYON: Issuer = {
  name: "Halcyon Trading Co",
  address: "0x2E1b7D4a9C3f8B6e0A5d2C7f1B9e4A8c3D6f0B2e",
  verified: true,
  jurisdiction: "Singapore",
};

export const APEX: Issuer = {
  name: "Apex Industrial Group",
  address: "0x9C3d8F1a4B7e2D5c0A6f3B8e1D4a7C2f5B0e9D3a",
  verified: true,
  jurisdiction: "Delaware, USA",
};

/** Not in the registry. Any mint from this address reverts in NoteFactory. */
export const UNVERIFIED: Issuer = {
  name: "Unregistered Wallet",
  address: "0x4B8e2A6d0F3c9B7e1D5a8C2f6B0e3D9a7C1f4B8e",
  verified: false,
  jurisdiction: "Unknown",
};

// ---------------------------------------------------------------------------
// 1. Meridian — the happy path. Clean document, one low-confidence field.
// ---------------------------------------------------------------------------

const MERIDIAN_NOTE: Note = {
  id: "meridian",
  name: "Meridian Freight Senior Note",
  symbol: "MFH-26",
  status: "review",
  issuer: MERIDIAN,
  document: {
    filename: "MeridianFreight_LoanAgreement.pdf",
    hash: "0x8f3c1a9e4b7d2f6a0c5e8b1d4a7f2c9e6b3d0a5f8c1e4b7d2a9f6c3e0b5d8a2b",
    body: [
      { kind: "title", text: "COMMERCIAL LOAN AGREEMENT" },
      {
        kind: "paragraph",
        text: 'THIS LOAN AGREEMENT (this "Agreement") is dated as of September 30, 2026, between MERIDIAN FREIGHT HOLDINGS LLC (the "Borrower") and NORTHBRIDGE CREDIT PARTNERS (the "Lender").',
      },
      { kind: "heading", text: "1. THE LOAN" },
      {
        kind: "paragraph",
        text: '1.1 Principal Amount. Subject to the terms and conditions of this Agreement, Lender agrees to lend to Borrower the principal sum of $2,500,000.00 (the "Loan"), advanced in a single drawing on the date hereof.',
      },
      {
        kind: "paragraph",
        text: "1.2 Interest. The principal amount of the Loan outstanding from time to time shall bear interest at a rate of 8.50% per annum, computed on a 30/360 basis.",
      },
      {
        kind: "paragraph",
        text: "1.3 Maturity Date. The entire outstanding principal balance of the Loan, together with all accrued and unpaid interest, shall be due and payable in full on September 30, 2029.",
      },
      {
        kind: "paragraph",
        text: "1.4 Payments. Borrower shall make payments of accrued interest on the last day of each calendar quarter, provided that the first such payment shall be due on December 31, 2026 and shall cover the period from the date hereof. Principal shall be repaid in a single instalment at maturity.",
      },
      { kind: "heading", text: "2. COVENANTS" },
      {
        kind: "paragraph",
        text: "2.1 Financial Reporting. Borrower shall deliver audited annual financial statements within 120 days of each fiscal year end.",
      },
      {
        kind: "paragraph",
        text: "2.2 Negative Pledge. Borrower shall not create or permit to exist any lien over the Collateral without the prior written consent of Lender.",
      },
      { kind: "heading", text: "3. DEFAULT" },
      {
        kind: "paragraph",
        text: "3.1 Late Payment. Any payment not received within 10 days of its due date shall bear additional interest at 2.00% per annum until paid.",
      },
      { kind: "heading", text: "EXHIBIT A — PAYMENT SCHEDULE" },
      {
        kind: "paragraph",
        text: "Payment Dates: 31 Dec 2026, 31 Mar 2027, 30 Jun 2027, 30 Sep 2027, 31 Dec 2027, 31 Mar 2028, 30 Jun 2028, 30 Sep 2028, 31 Dec 2028, 31 Mar 2029, 30 Jun 2029, 30 Sep 2029. Interest due on each Payment Date: $53,125.00. Principal due on the final Payment Date: $2,500,000.00.",
      },
    ],
  },
  currency: "USDG",
  paidPeriods: [],
  terms: {
    borrower: {
      value: "Meridian Freight Holdings LLC",
      confidence: 0.99,
      sourceQuote: "MERIDIAN FREIGHT HOLDINGS LLC",
    },
    lender: {
      value: "Northbridge Credit Partners",
      confidence: 0.99,
      sourceQuote: "NORTHBRIDGE CREDIT PARTNERS",
    },
    principal: {
      value: 2_500_000,
      confidence: 0.99,
      sourceQuote: "$2,500,000.00",
    },
    interestRatePct: {
      value: 8.5,
      confidence: 0.98,
      sourceQuote: "8.50% per annum",
    },
    dayCount: {
      value: "30/360",
      confidence: 0.96,
      sourceQuote: "computed on a 30/360 basis",
    },
    agreementDate: {
      value: "2026-09-30",
      confidence: 0.97,
      sourceQuote: "dated as of September 30, 2026",
    },
    maturityDate: {
      value: "2029-09-30",
      confidence: 0.95,
      sourceQuote: "due and payable in full on September 30, 2029",
    },
    // The demo's amber field: the clause describes a cadence in prose and the
    // schedule lives in a separate exhibit, so the two have to be reconciled.
    paymentFrequency: {
      value: "quarterly",
      confidence: 0.82,
      sourceQuote: "the last day of each calendar quarter",
      note: "Clause 1.4 describes the cadence in prose while the dates are listed separately in Exhibit A. Cadence inferred by matching the twelve Exhibit A dates to calendar quarter-ends — confirm this is quarterly and not a stub first period.",
    },
    schedule: {
      value: interestOnlySchedule(
        [
          "2026-12-31",
          "2027-03-31",
          "2027-06-30",
          "2027-09-30",
          "2027-12-31",
          "2028-03-31",
          "2028-06-30",
          "2028-09-30",
          "2028-12-31",
          "2029-03-31",
          "2029-06-30",
          "2029-09-30",
        ],
        2_500_000,
        53_125,
      ),
      confidence: 0.94,
      sourceQuote: "Interest due on each Payment Date: $53,125.00",
    },
    covenants: {
      value: [
        {
          kind: "financial-reporting",
          text: "Audited annual financial statements within 120 days of each fiscal year end.",
        },
        {
          kind: "negative-pledge",
          text: "No lien over the Collateral without prior written consent of Lender.",
        },
      ],
      confidence: 0.93,
      sourceQuote:
        "Borrower shall deliver audited annual financial statements within 120 days of each fiscal year end.",
    },
    latePayment: {
      value: { gracePeriodDays: 10, penaltyRatePct: 2 },
      confidence: 0.95,
      sourceQuote:
        "within 10 days of its due date shall bear additional interest at 2.00% per annum",
    },
  },
};

// ---------------------------------------------------------------------------
// 2. Halcyon — the ambiguous document. The stated rate and the payment table
//    describe different loans, and no amount of human review reconciles them.
//    The validator blocks the mint on arithmetic alone.
// ---------------------------------------------------------------------------

const HALCYON_NOTE: Note = {
  id: "halcyon",
  name: "Halcyon Trading Note",
  symbol: "HTC-26",
  status: "review",
  issuer: HALCYON,
  document: {
    filename: "HalcyonTrading_LoanNote.pdf",
    hash: "0x3d7f2b8e1a4c9f6d0b5e8a2c7f1d4b9e6a3c0f5d8b2e7a1c4f9d6b3e0a5c8f2d",
    body: [
      { kind: "title", text: "LOAN NOTE" },
      {
        kind: "paragraph",
        text: 'This Note is made on October 15, 2026 by HALCYON TRADING CO (the "Borrower") in favour of STERLING MERCHANT CAPITAL (the "Holder").',
      },
      {
        kind: "paragraph",
        text: "1. Principal. The principal sum advanced under this Note is $750,000.00.",
      },
      {
        kind: "paragraph",
        text: "2. Interest. Interest accrues at six per cent (6.00%) per annum on a 30/360 basis, save that the Borrower and Holder have agreed a blended rate reflecting the arrangement fee and certain other charges, as set out in the payment table below.",
      },
      {
        kind: "paragraph",
        text: "3. Maturity. This Note matures on October 15, 2029, on which date the principal sum falls due in full.",
      },
      {
        kind: "paragraph",
        text: "4. Payments. Semi-annual payments of interest only, on the fifteenth day of April and October in each year.",
      },
      { kind: "heading", text: "PAYMENT TABLE" },
      {
        kind: "paragraph",
        text: "15 Apr 2027 — $35,250.00; 15 Oct 2027 — $35,250.00; 15 Apr 2028 — $35,250.00; 15 Oct 2028 — $35,250.00; 15 Apr 2029 — $35,250.00; 15 Oct 2029 — $35,250.00 together with principal of $750,000.00.",
      },
      {
        kind: "paragraph",
        text: "5. Late Payment. Sums overdue bear additional interest at 3.00% per annum. No grace period applies.",
      },
    ],
  },
  currency: "USDG",
  paidPeriods: [],
  terms: {
    borrower: {
      value: "Halcyon Trading Co",
      confidence: 0.98,
      sourceQuote: "HALCYON TRADING CO",
    },
    lender: {
      value: "Sterling Merchant Capital",
      confidence: 0.98,
      sourceQuote: "STERLING MERCHANT CAPITAL",
    },
    principal: {
      value: 750_000,
      confidence: 0.97,
      sourceQuote: "$750,000.00",
    },
    interestRatePct: {
      value: 6,
      confidence: 0.61,
      sourceQuote: "six per cent (6.00%) per annum",
      note: "Clause 2 states 6.00% but defers to a 'blended rate' that is never stated as a number. The payment table implies roughly 9.40%. The two figures describe different loans.",
    },
    dayCount: {
      value: "30/360",
      confidence: 0.91,
      sourceQuote: "on a 30/360 basis",
    },
    agreementDate: {
      value: "2026-10-15",
      confidence: 0.96,
      sourceQuote: "made on October 15, 2026",
    },
    maturityDate: {
      value: "2029-10-15",
      confidence: 0.95,
      sourceQuote: "matures on October 15, 2029",
    },
    paymentFrequency: {
      value: "semiannual",
      confidence: 0.94,
      sourceQuote: "Semi-annual payments of interest only",
    },
    schedule: {
      value: interestOnlySchedule(
        [
          "2027-04-15",
          "2027-10-15",
          "2028-04-15",
          "2028-10-15",
          "2029-04-15",
          "2029-10-15",
        ],
        750_000,
        35_250,
      ),
      confidence: 0.58,
      sourceQuote: "15 Apr 2027 — $35,250.00",
      note: "Transcribed from the payment table. These amounts do not reconcile with the stated 6.00% rate.",
    },
    covenants: { value: [], confidence: 0.88, sourceQuote: "" },
    latePayment: {
      value: { gracePeriodDays: 0, penaltyRatePct: 3 },
      confidence: 0.92,
      sourceQuote:
        "Sums overdue bear additional interest at 3.00% per annum. No grace period applies.",
    },
  },
};

// ---------------------------------------------------------------------------
// 3. Apex — already live on testnet, one coupon settled. Backs the token page
//    so it can be shown without walking the mint flow first.
// ---------------------------------------------------------------------------

const APEX_NOTE: Note = {
  id: "apex",
  name: "Apex Industrial Senior Note",
  symbol: "APX-26",
  status: "live",
  issuer: APEX,
  address: "0x5E9a3C7f1B4d8A2e6C0f9B3d7A1e5C8f2B6d0A4e",
  document: {
    filename: "ApexIndustrial_LoanAgreement.pdf",
    hash: "0xa1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0a3b6c9d2e5f8a1b4",
    body: [
      { kind: "title", text: "COMMERCIAL LOAN AGREEMENT" },
      {
        kind: "paragraph",
        text: 'THIS LOAN AGREEMENT is dated as of March 31, 2026, between APEX INDUSTRIAL GROUP (the "Borrower") and NORTHBRIDGE CREDIT PARTNERS (the "Lender").',
      },
      {
        kind: "paragraph",
        text: "1.1 Principal Amount. Lender agrees to lend to Borrower the principal sum of $1,200,000.00.",
      },
      {
        kind: "paragraph",
        text: "1.2 Interest. The Loan shall bear interest at a rate of 7.25% per annum, computed on a 30/360 basis, payable quarterly in arrears.",
      },
      {
        kind: "paragraph",
        text: "1.3 Maturity Date. All outstanding principal and accrued interest shall be due and payable in full on March 31, 2029.",
      },
    ],
  },
  currency: "USDG",
  paidPeriods: [1],
  terms: {
    borrower: {
      value: "Apex Industrial Group",
      confidence: 0.99,
      sourceQuote: "APEX INDUSTRIAL GROUP",
    },
    lender: {
      value: "Northbridge Credit Partners",
      confidence: 0.99,
      sourceQuote: "NORTHBRIDGE CREDIT PARTNERS",
    },
    principal: {
      value: 1_200_000,
      confidence: 0.99,
      sourceQuote: "$1,200,000.00",
    },
    interestRatePct: {
      value: 7.25,
      confidence: 0.98,
      sourceQuote: "7.25% per annum",
    },
    dayCount: {
      value: "30/360",
      confidence: 0.97,
      sourceQuote: "computed on a 30/360 basis",
    },
    agreementDate: {
      value: "2026-03-31",
      confidence: 0.98,
      sourceQuote: "dated as of March 31, 2026",
    },
    maturityDate: {
      value: "2029-03-31",
      confidence: 0.97,
      sourceQuote: "due and payable in full on March 31, 2029",
    },
    paymentFrequency: {
      value: "quarterly",
      confidence: 0.96,
      sourceQuote: "payable quarterly in arrears",
    },
    schedule: {
      value: interestOnlySchedule(
        [
          "2026-06-30",
          "2026-09-30",
          "2026-12-31",
          "2027-03-31",
          "2027-06-30",
          "2027-09-30",
          "2027-12-31",
          "2028-03-31",
          "2028-06-30",
          "2028-09-30",
          "2028-12-31",
          "2029-03-31",
        ],
        1_200_000,
        21_750,
      ),
      confidence: 0.95,
      sourceQuote: "payable quarterly in arrears",
    },
    covenants: { value: [], confidence: 0.94, sourceQuote: "" },
    latePayment: {
      value: { gracePeriodDays: 30, penaltyRatePct: 2 },
      confidence: 0.93,
      sourceQuote: "",
    },
  },
};

export const SEED_NOTES: Note[] = [MERIDIAN_NOTE, HALCYON_NOTE, APEX_NOTE];

/** Registry members, as the admin portal would list them. */
export const REGISTERED_ISSUERS: Issuer[] = [MERIDIAN, HALCYON, APEX];

/** Wallets the demo can connect as. */
export const DEMO_WALLETS: Issuer[] = [MERIDIAN, UNVERIFIED];
