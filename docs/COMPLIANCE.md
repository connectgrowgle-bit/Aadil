# GrowEazzy — Compliance Flags

**This document raises questions for a lawyer. It reaches no legal
conclusions and nothing in it should be read as legal advice or as a
substitute for review by qualified Indian counsel before launch.**

## Items flagged LEGAL/COMPLIANCE REVIEW REQUIRED

- Affiliate registration fee (₹2,000)
- 10% single-level commission model
- Refund policy
- Affiliate programme terms
- Payout terms and TDS treatment
- KYC collection and PII retention period
- GST treatment of commissions and service sales
- Customer service / support terms
- Real-estate lead-generation claims (RERA-adjacent marketing language)
- Privacy obligations (DPDP Act 2023 and successor rules)

None of the above have been reviewed by counsel as part of this build. Do
not launch on the strength of the engineering mitigations below alone.

## The ₹2,000 registration fee — highest non-technical risk

Two statutes are potentially in play for a paid-entry, commission-earning
programme in India:

- The **Consumer Protection (Direct Selling) Rules, 2021** restrict and
  regulate entry/participation fees charged by direct sellers.
- The **Prize Chits and Money Circulation Schemes (Banning) Act, 1978**
  criminalises schemes where the primary return is contingent on enrolling
  further participants ("pay to join, earn by recruiting").

GrowEazzy's design is intended to sit outside the second category, but that
is an engineering intent, not a legal determination. The mitigations built
into the system:

1. **Single-level only.** `affiliates` has no parent/upline relationship in
   the schema. There is no code path, anywhere, that pays a commission for
   recruiting another affiliate — only for a qualifying sale of one of the
   three services. This is structural, not a toggle: the tables cannot
   express a second level.
2. **Fee is admin-configurable and switchable off entirely** —
   `settings` carries `affiliate.registrationFee.enabled` and
   `affiliate.registrationFee.amountPaise`, independent of the commission
   rate.
3. **Real training is delivered for the fee** — the training portal
   (Phase 8) is not decorative; the fee is positioned against course access,
   not against the right to earn commissions.
4. **Cooling-off period, versioned terms, and a named grievance officer**
   are requirements the platform must surface (a cooling-off window before
   the fee is non-refundable, `terms` versioned with an effective date shown
   to the affiliate at signup, and a named/contactable grievance officer per
   the Consumer Protection Rules) — these are business/legal inputs the
   engineering side cannot originate on its own and are tracked as open
   decisions in `docs/ARCHITECTURE.md` §2.

## What engineering can and cannot close

Engineering can make the fee technically optional, keep the programme
structurally single-level, and keep terms versioned and auditable. Engineering
cannot determine whether ₹2,000 at the current commission structure is, in
fact, compliant with the Direct Selling Rules or outside the reach of the
1978 Act — that determination requires counsel who has reviewed the live
terms, the actual sales conduct, and the current regulatory guidance, none
of which this build can access or evaluate.
