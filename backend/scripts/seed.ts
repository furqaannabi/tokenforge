/**
 * Seeds the two demo documents with pre-computed extractions.
 *
 * These are the terms a model would produce, written by hand so the review flow
 * can be walked without a model key and without spending anything. The
 * validator runs for real over them, so the verdicts below are computed rather
 * than asserted — Halcyon is INVALID because the arithmetic genuinely does not
 * hold, not because this script says so.
 *
 *   bun run db:seed
 */

import { keccak256, toBytes } from "viem";
import {
  fieldsNeedingReview,
  validateTerms,
  type ExtractedTerms,
  type PaymentPeriod,
} from "@tokenforge/core";
import { prisma } from "../src/db";

function interestOnly(
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

const MERIDIAN_TEXT = `COMMERCIAL LOAN AGREEMENT

THIS LOAN AGREEMENT (this "Agreement") is dated as of September 30, 2026, between MERIDIAN FREIGHT HOLDINGS LLC (the "Borrower") and NORTHBRIDGE CREDIT PARTNERS (the "Lender").

1. THE LOAN

1.1 Principal Amount. Subject to the terms and conditions of this Agreement, Lender agrees to lend to Borrower the principal sum of $2,500,000.00 (the "Loan"), advanced in a single drawing on the date hereof.

1.2 Interest. The principal amount of the Loan outstanding from time to time shall bear interest at a rate of 8.50% per annum, computed on a 30/360 basis.

1.3 Maturity Date. The entire outstanding principal balance of the Loan, together with all accrued and unpaid interest, shall be due and payable in full on September 30, 2029.

1.4 Payments. Borrower shall make payments of accrued interest on the last day of each calendar quarter, provided that the first such payment shall be due on December 31, 2026 and shall cover the period from the date hereof. Principal shall be repaid in a single instalment at maturity.

2. COVENANTS

2.1 Financial Reporting. Borrower shall deliver audited annual financial statements within 120 days of each fiscal year end.

2.2 Negative Pledge. Borrower shall not create or permit to exist any lien over the Collateral without the prior written consent of Lender.

3. DEFAULT

3.1 Late Payment. Any payment not received within 10 days of its due date shall bear additional interest at 2.00% per annum until paid.

EXHIBIT A - PAYMENT SCHEDULE

Payment Dates: 31 Dec 2026, 31 Mar 2027, 30 Jun 2027, 30 Sep 2027, 31 Dec 2027, 31 Mar 2028, 30 Jun 2028, 30 Sep 2028, 31 Dec 2028, 31 Mar 2029, 30 Jun 2029, 30 Sep 2029. Interest due on each Payment Date: $53,125.00. Principal due on the final Payment Date: $2,500,000.00.`;

const MERIDIAN_TERMS: ExtractedTerms = {
  borrower: {
    value: "Meridian Freight Holdings LLC",
    confidence: 0.99,
    sourceQuote: "MERIDIAN FREIGHT HOLDINGS LLC",
    note: null,
  },
  lender: {
    value: "Northbridge Credit Partners",
    confidence: 0.99,
    sourceQuote: "NORTHBRIDGE CREDIT PARTNERS",
    note: null,
  },
  principal: {
    value: 2_500_000,
    confidence: 0.99,
    sourceQuote: "$2,500,000.00",
    note: null,
  },
  currency: {
    value: "USDG",
    confidence: 0.97,
    sourceQuote: "the principal sum of $2,500,000.00",
    note: null,
  },
  interestRatePct: {
    value: 8.5,
    confidence: 0.98,
    sourceQuote: "8.50% per annum",
    note: null,
  },
  dayCount: {
    value: "30/360",
    confidence: 0.96,
    sourceQuote: "computed on a 30/360 basis",
    note: null,
  },
  agreementDate: {
    value: "2026-09-30",
    confidence: 0.97,
    sourceQuote: "dated as of September 30, 2026",
    note: null,
  },
  maturityDate: {
    value: "2029-09-30",
    confidence: 0.95,
    sourceQuote: "due and payable in full on September 30, 2029",
    note: null,
  },
  // The demo's amber field: prose cadence in one clause, dates in another.
  paymentFrequency: {
    value: "quarterly",
    confidence: 0.82,
    sourceQuote: "the last day of each calendar quarter",
    note: "Clause 1.4 describes the cadence in prose while the dates are listed separately in Exhibit A. Cadence inferred by matching the twelve Exhibit A dates to calendar quarter-ends — confirm this is quarterly and not a stub first period.",
  },
  schedule: {
    value: interestOnly(
      [
        "2026-12-31", "2027-03-31", "2027-06-30", "2027-09-30",
        "2027-12-31", "2028-03-31", "2028-06-30", "2028-09-30",
        "2028-12-31", "2029-03-31", "2029-06-30", "2029-09-30",
      ],
      2_500_000,
      53_125,
    ),
    confidence: 0.94,
    sourceQuote: "Interest due on each Payment Date: $53,125.00",
    note: null,
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
    note: null,
  },
  latePayment: {
    value: { gracePeriodDays: 10, penaltyRatePct: 2 },
    confidence: 0.95,
    sourceQuote:
      "within 10 days of its due date shall bear additional interest at 2.00% per annum",
    note: null,
  },
};

const HALCYON_TEXT = `LOAN NOTE

This Note is made on October 15, 2026 by HALCYON TRADING CO (the "Borrower") in favour of STERLING MERCHANT CAPITAL (the "Holder").

1. Principal. The principal sum advanced under this Note is $750,000.00.

2. Interest. Interest accrues at six per cent (6.00%) per annum on a 30/360 basis, save that the Borrower and Holder have agreed a blended rate reflecting the arrangement fee and certain other charges, as set out in the payment table below.

3. Maturity. This Note matures on October 15, 2029, on which date the principal sum falls due in full.

4. Payments. Semi-annual payments of interest only, on the fifteenth day of April and October in each year.

PAYMENT TABLE

15 Apr 2027 - $35,250.00; 15 Oct 2027 - $35,250.00; 15 Apr 2028 - $35,250.00; 15 Oct 2028 - $35,250.00; 15 Apr 2029 - $35,250.00; 15 Oct 2029 - $35,250.00 together with principal of $750,000.00.

5. Late Payment. Sums overdue bear additional interest at 3.00% per annum. No grace period applies.`;

const HALCYON_TERMS: ExtractedTerms = {
  borrower: {
    value: "Halcyon Trading Co",
    confidence: 0.98,
    sourceQuote: "HALCYON TRADING CO",
    note: null,
  },
  lender: {
    value: "Sterling Merchant Capital",
    confidence: 0.98,
    sourceQuote: "STERLING MERCHANT CAPITAL",
    note: null,
  },
  principal: {
    value: 750_000,
    confidence: 0.97,
    sourceQuote: "$750,000.00",
    note: null,
  },
  currency: {
    value: "USDG",
    confidence: 0.96,
    sourceQuote: "The principal sum advanced under this Note is $750,000.00.",
    note: null,
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
    note: null,
  },
  agreementDate: {
    value: "2026-10-15",
    confidence: 0.96,
    sourceQuote: "made on October 15, 2026",
    note: null,
  },
  maturityDate: {
    value: "2029-10-15",
    confidence: 0.95,
    sourceQuote: "matures on October 15, 2029",
    note: null,
  },
  paymentFrequency: {
    value: "semiannual",
    confidence: 0.94,
    sourceQuote: "Semi-annual payments of interest only",
    note: null,
  },
  schedule: {
    value: interestOnly(
      ["2027-04-15", "2027-10-15", "2028-04-15", "2028-10-15", "2029-04-15", "2029-10-15"],
      750_000,
      35_250,
    ),
    confidence: 0.58,
    sourceQuote: "15 Apr 2027 - $35,250.00",
    note: "Transcribed from the payment table. These amounts do not reconcile with the stated 6.00% rate.",
  },
  covenants: { value: [], confidence: 0.88, sourceQuote: "", note: null },
  latePayment: {
    value: { gracePeriodDays: 0, penaltyRatePct: 3 },
    confidence: 0.92,
    sourceQuote:
      "Sums overdue bear additional interest at 3.00% per annum. No grace period applies.",
    note: null,
  },
};

const FIXTURES = [
  { filename: "MeridianFreight_LoanAgreement.pdf", text: MERIDIAN_TEXT, terms: MERIDIAN_TERMS },
  { filename: "HalcyonTrading_LoanNote.pdf", text: HALCYON_TEXT, terms: HALCYON_TERMS },
];

async function seed() {
  for (const fixture of FIXTURES) {
    const bytes = toBytes(fixture.text);
    const contentHash = keccak256(bytes);

    const document = await prisma.document.upsert({
      where: { contentHash },
      update: {},
      create: {
        filename: fixture.filename,
        mimeType: "application/pdf",
        text: fixture.text,
        byteSize: bytes.length,
        contentHash,
      },
    });

    // Run the real validator rather than hard-coding a verdict.
    const validation = validateTerms(fixture.terms);
    const unreviewed = fieldsNeedingReview(fixture.terms);
    const status = !validation.consistent
      ? "INVALID"
      : unreviewed.length > 0
        ? "NEEDS_REVIEW"
        : "VALIDATED";

    const existing = await prisma.extraction.findFirst({
      where: { documentId: document.id },
    });

    const extraction = existing
      ? await prisma.extraction.update({
          where: { id: existing.id },
          data: {
            terms: fixture.terms as never,
            issues: validation.issues as never,
            consistent: validation.consistent,
            unreviewedFields: unreviewed,
            status,
          },
        })
      : await prisma.extraction.create({
          data: {
            documentId: document.id,
            model: "seed/hand-written",
            status,
            terms: fixture.terms as never,
            issues: validation.issues as never,
            consistent: validation.consistent,
            unreviewedFields: unreviewed,
          },
        });

    console.log(
      `${fixture.filename.padEnd(38)} ${status.padEnd(13)} /review/${extraction.id}`,
    );
    for (const issue of validation.issues) {
      console.log(`    ${issue.severity}: ${issue.message}`);
    }
  }
}

await seed();
await prisma.$disconnect();
