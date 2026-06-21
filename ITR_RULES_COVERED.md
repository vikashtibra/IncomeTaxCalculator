# ITR Rules Covered (FY 2025-26 / AY 2026-27)

This document mirrors exactly what the tax engine (`compute()` / `calcRegime()` in [src/App.jsx](src/App.jsx)) implements — not a general summary of Indian tax law. If a rule isn't listed here, the calculator doesn't account for it.

**Scope:** Resident Individuals only. Excludes NRIs, HUFs, foreign assets/income, Crypto/VDA, companies, LLPs.

## Tax Slabs

**Old Regime**
| Income | Rate |
|---|---|
| 0 – 2,50,000 | 0% |
| 2,50,001 – 5,00,000 | 5% |
| 5,00,001 – 10,00,000 | 20% |
| Above 10,00,000 | 30% |

**New Regime**
| Income | Rate |
|---|---|
| 0 – 3,00,000 | 0% |
| 3,00,001 – 7,00,000 | 5% |
| 7,00,001 – 10,00,000 | 10% |
| 10,00,001 – 12,00,000 | 15% |
| 12,00,001 – 15,00,000 | 20% |
| Above 15,00,000 | 30% |

## Rebate (Section 87A)

- **New Regime:** taxable income ≤ ₹12,00,000 → rebate up to ₹60,000 (capped at base tax)
- **Old Regime:** taxable income ≤ ₹5,00,000 → rebate up to ₹12,500 (capped at base tax)

## Surcharge

| Taxable income | New Regime | Old Regime |
|---|---|---|
| > ₹50,00,000 | 10% | 10% |
| > ₹1,00,00,000 | 15% | 15% |
| > ₹2,00,00,000 | 25% | 25% |
| > ₹5,00,00,000 | — (25% max in New) | 37% |

## Health & Education Cess

4% on (tax after rebate + surcharge), both regimes.

## Salary Income

- **Standard Deduction:** ₹50,000 (Old) / ₹75,000 (New), applied if gross salary > 0
- **HRA Exemption** (Old Regime only): least of —
  - HRA actually received
  - Rent paid − 10% of (Basic + DA)
  - 50% of (Basic + DA) for metro cities (Delhi/Mumbai/Chennai/Kolkata), 40% for non-metro
- LTA exemption, Gratuity exemption (cap ₹20L), Leave Encashment exemption (cap ₹25L) — entered directly by the user, not separately validated against statutory limits
- Multiple employers supported; gross/HRA/TDS aggregated across all

## House Property

- **Self-occupied:** home loan interest deduction capped at ₹2,00,000 (Old Regime only; New Regime gives ₹0 for self-occupied)
- **Let-out:** Net Annual Value (rent − municipal tax) less 30% standard deduction less loan interest; loss capped at ₹2,00,000 against other income (Sec 71(3A)); allowed in **both** regimes

## Capital Gains

- **Equity LTCG** (held > 1 year): 12.5% on amount exceeding ₹1,00,000/year exemption
- **Equity STCG** (held < 1 year): flat 20%
- **Other Assets LTCG** (property, gold, etc.): 20% with indexation (pre-23-Jul-2024 acquisitions) or 12.5% without, user's choice
- **Other Assets STCG**: added to total income, taxed at slab rate
- **Debt Mutual Fund / Bond Fund gains** (post-April 2023): added to total income, taxed at slab rate
- 4% cess applied on the special-rate capital gains tax (LTCG/STCG equity + LTCG other); slab-taxed components get cess as part of the regular computation
- Capital gains tax is identical under both regimes (added to both Old and New totals equally)
- Loss set-off: negative STCG-equity first offsets LTCG-equity (Sec 70-74); resulting LTCG floored at 0

## Business / Professional Income (Presumptive)

- **Sec 44ADA** (Professional — doctors, lawyers, CAs, engineers, etc.): gross receipts up to ₹75L, net income ≥ 50% of gross
- **Sec 44AD** (Business): turnover up to ₹2Cr, 6% (digital receipts) / 8% (cash) presumptive rate
- Any business income forces the recommendation toward **ITR-3** and triggers a **Form 10-IEA** flag if Old Regime is selected (required to opt for Old Regime when business income exists)

## Other Income

- Savings account interest, Fixed Deposit interest (entered gross, pre-TDS), Dividend income, Other income (gifts >₹50K, winnings, etc.) — all added to Gross Total Income in both regimes

## Deductions (Old Regime, unless noted)

| Section | Limit |
|---|---|
| 80C | ₹1,50,000 |
| 80CCD(1B) — additional NPS | ₹50,000 (**both regimes**) |
| 80CCD(2) — Employer NPS | No cap enforced by the tool (informational note: 10% of Basic+DA private / 14% govt); **both regimes** |
| 80D — Self/Family | ₹25,000 (₹50,000 if senior citizen) |
| 80D — Parents | ₹25,000 (₹50,000 if parents are senior citizens) |
| 80G — Donations | User-entered net deductible amount, no cap enforced |
| 80E — Education loan interest | No cap enforced |
| 80EE — First home loan (loans FY2016-17) | ₹50,000 |
| 80EEA — First home loan (loans Apr 2019–Mar 2022) | ₹1,50,000 |
| 80TTA — Savings interest (non-senior) | ₹10,000 (savings interest only) |
| 80TTB — Interest (senior citizen) | ₹50,000 (savings + FD interest) |

**New Regime** only allows 80CCD(1B) and 80CCD(2) — everything else above is Old Regime only.

The tool warns if both 80EE and 80EEA are claimed simultaneously (only one is allowed).

## TDS, Advance Tax & Interest

- Total credits = Employer TDS + Other TDS (FD/rent/etc.) + Advance Tax paid
- **Section 234B estimate:** if credits paid are less than 90% of the recommended regime's total tax, and that total exceeds ₹10,000 → estimated interest = (tax due) × 1% × 4 months. This is a simplified estimate, not the full 234B/234C calculation.

## ITR Form Selection Logic

- **ITR-3** if any business/professional income is entered
- **ITR-2** if any of: equity or other-asset capital gains > 0, house property is let-out (not self-occupied), gross salary > ₹50L, taxpayer is a company director, taxpayer holds unlisted equity shares, or dividend income > ₹10L
- **ITR-1** (Sahaj) otherwise

## Regime Recommendation

Old vs New total tax (including capital gains tax, identical in both) are compared; whichever is lower is recommended. Capital gains tax itself does not change the recommendation since it's added equally to both totals — the comparison is driven by the salary/business/other-income computation under each regime's slabs and deductions.

## What's explicitly NOT covered

- NRIs, HUFs, foreign income/assets, Crypto/VDA, companies, LLPs (per Terms of Service)
- Full Section 234A/234B/234C interest calculations (only a simplified 234B estimate)
- Statutory caps on Gratuity/Leave Encashment/LTA exemptions (user-entered, not auto-validated)
- AMT, MAT, or other alternate minimum tax regimes
- TDS/AIS reconciliation (the app tells you to verify against Form 26AS/AIS yourself)
