import { describe, it, expect } from "vitest";
import { slabTax, calcRegime, compute, mkState, OLD_SLABS, NEW_SLABS } from "./taxEngine";

// Builds a full compute() input from a partial override, so each test only
// specifies the fields it cares about.
function buildInput(overrides = {}) {
  const base = mkState();
  return {
    ...base,
    ...overrides,
    employers: overrides.employers ?? base.employers,
    house: { ...base.house, ...(overrides.house || {}) },
    cg: { ...base.cg, ...(overrides.cg || {}) },
    biz: { ...base.biz, ...(overrides.biz || {}) },
    other: { ...base.other, ...(overrides.other || {}) },
    ded: { ...base.ded, ...(overrides.ded || {}) },
    tds: { ...base.tds, ...(overrides.tds || {}) },
    profile: { ...base.profile, ...(overrides.profile || {}) },
  };
}

describe("slabTax", () => {
  it("returns 0 for zero or negative income", () => {
    expect(slabTax(0, OLD_SLABS)).toBe(0);
    expect(slabTax(-100, OLD_SLABS)).toBe(0);
  });

  it("applies 0% on the first Old Regime slab", () => {
    expect(slabTax(250000, OLD_SLABS)).toBe(0);
  });

  it("computes Old Regime tax across multiple slabs", () => {
    // 12,00,000: 0 on first 2.5L, 5% on next 2.5L (12500), 20% on next 5L (100000), 30% on remaining 2L (60000)
    expect(slabTax(1200000, OLD_SLABS)).toBe(172500);
  });

  it("computes New Regime tax across multiple slabs (Budget 2025 / FY 2025-26 slabs)", () => {
    // 12,00,000: 0 on first 4L, 5% on next 4L (20000), 10% on next 4L (40000)
    expect(slabTax(1200000, NEW_SLABS)).toBe(60000);
  });
});

describe("calcRegime - rebate (Section 87A)", () => {
  it("New Regime: full rebate at exactly Rs.12L taxable income (net tax zero)", () => {
    const r = calcRegime(1200000, "new");
    expect(r.rebate).toBe(r.base);
    expect(r.total).toBe(0);
  });

  it("New Regime: no rebate just above Rs.12L", () => {
    const r = calcRegime(1200001, "new");
    expect(r.rebate).toBe(0);
  });

  it("Old Regime: full rebate at exactly Rs.5L taxable income", () => {
    const r = calcRegime(500000, "old");
    expect(r.rebate).toBe(r.base);
    expect(r.total).toBe(0);
  });

  it("Old Regime: no rebate just above Rs.5L", () => {
    const r = calcRegime(500001, "old");
    expect(r.rebate).toBe(0);
  });
});

describe("calcRegime - surcharge", () => {
  it("no surcharge below Rs.50L for either regime", () => {
    expect(calcRegime(4000000, "old").surcharge).toBe(0);
    expect(calcRegime(4000000, "new").surcharge).toBe(0);
  });

  it("10% surcharge just above Rs.50L", () => {
    const r = calcRegime(5000001, "old");
    expect(r.surcharge).toBe(Math.round(r.afterRebate * 0.10));
  });

  it("Old Regime applies 37% surcharge above Rs.5Cr, New Regime caps at 25%", () => {
    const old = calcRegime(50000001, "old");
    const newR = calcRegime(50000001, "new");
    expect(old.surcharge).toBe(Math.round(old.afterRebate * 0.37));
    expect(newR.surcharge).toBe(Math.round(newR.afterRebate * 0.25));
  });
});

describe("calcRegime - cess", () => {
  it("applies 4% cess on (afterRebate + surcharge)", () => {
    const r = calcRegime(1500000, "old");
    expect(r.cess).toBe(Math.round((r.afterRebate + r.surcharge) * 0.04));
    expect(r.total).toBe(r.afterRebate + r.surcharge + r.cess);
  });
});

describe("compute - salary & standard deduction", () => {
  it("applies Rs.50,000 std deduction (Old) / Rs.75,000 (New) when there is salary", () => {
    const r = compute(buildInput({ employers: [{ ...mkState().employers[0], gross: "1000000" }] }));
    expect(r.stdOld).toBe(50000);
    expect(r.stdNew).toBe(75000);
  });

  it("applies no standard deduction when gross salary is zero", () => {
    const r = compute(buildInput());
    expect(r.stdOld).toBe(0);
    expect(r.stdNew).toBe(0);
  });

  it("sums gross salary across multiple employers", () => {
    const r = compute(buildInput({
      employers: [
        { ...mkState().employers[0], gross: "600000" },
        { ...mkState().employers[0], gross: "400000" },
      ],
    }));
    expect(r.gross).toBe(1000000);
  });
});

describe("compute - HRA exemption", () => {
  it("takes the least of: HRA received, rent - 10% of (basic+DA), 50%/40% of (basic+DA)", () => {
    const r = compute(buildInput({
      employers: [{ name:"", gross:"1200000", basic:"600000", da:"0", hra:"300000", tds:"" }],
      ded: { rentPaid: "240000", hraCity: "metro" },
    }));
    // HRA received: 300000. Rent - 10% of basic: 240000 - 60000 = 180000. 50% of basic: 300000.
    // Least of (300000, 180000, 300000) = 180000
    expect(r.hraCalc).toBe(180000);
  });

  it("is zero when rent paid is not entered", () => {
    const r = compute(buildInput({
      employers: [{ name:"", gross:"1200000", basic:"600000", da:"0", hra:"300000", tds:"" }],
    }));
    expect(r.hraCalc).toBe(0);
  });

  it("an explicit override replaces the auto-calculated HRA exemption", () => {
    const r = compute(buildInput({
      employers: [{ name:"", gross:"1200000", basic:"600000", da:"0", hra:"300000", tds:"" }],
      ded: { rentPaid: "240000", hraOverride: "50000" },
    }));
    expect(r.hraEx).toBe(50000);
    expect(r.hraCalc).toBe(180000); // auto-calc still reported separately
  });
});

describe("compute - house property", () => {
  it("self-occupied: loan interest deduction capped at Rs.2,00,000 (Old), zero (New)", () => {
    const r = compute(buildInput({ house: { selfOccupied: true, loanInt: "350000" } }));
    expect(r.hpOld).toBe(-200000);
    expect(r.hpNew).toBe(0);
  });

  it("let-out: NAV minus 30% standard deduction minus loan interest, same in both regimes", () => {
    const r = compute(buildInput({
      house: { selfOccupied: false, rent: "240000", munTax: "12000", loanInt: "50000" },
    }));
    // NAV = 240000-12000=228000; -30% = 159600; -50000 loan = 109600
    expect(r.hpOld).toBe(109600);
    expect(r.hpNew).toBe(109600);
  });

  it("let-out loss is capped at -Rs.2,00,000", () => {
    const r = compute(buildInput({
      house: { selfOccupied: false, rent: "0", munTax: "0", loanInt: "500000" },
    }));
    expect(r.hpOld).toBe(-200000);
  });
});

describe("compute - capital gains", () => {
  it("equity LTCG: first Rs.1,00,000 exempt, 12.5% above that", () => {
    const r = compute(buildInput({ cg: { ltcgEq: "300000" } }));
    expect(r.ltcgEqTax).toBe(Math.round((300000 - 100000) * 0.125));
  });

  it("equity STCG: flat 20%, no exemption", () => {
    const r = compute(buildInput({ cg: { stcgEq: "100000" } }));
    expect(r.stcgEqTax).toBe(20000);
  });

  it("KNOWN LIMITATION: negative STCG-equity can't actually reach the set-off logic, because pn() clamps all parsed input to >=0 before it gets there - so Sec 70-74 set-off is currently dead code, not a working feature", () => {
    const r = compute(buildInput({ cg: { ltcgEq: "150000", stcgEq: "-50000" } }));
    expect(r.stcgEq).toBe(0); // pn() clamps "-50000" to 0 before the offset check ever runs
    expect(r.ltcgEq).toBe(150000); // never reduced by the (unreachable) offset
    expect(r.ltcgEqTax).toBe(Math.round((150000 - 100000) * 0.125));
  });

  it("other-asset LTCG: 20% with indexation toggle, 12.5% without", () => {
    const withIdx = compute(buildInput({ cg: { ltcgOth: "200000", useIndexation: true } }));
    const without = compute(buildInput({ cg: { ltcgOth: "200000", useIndexation: false } }));
    expect(withIdx.ltcgOthTax).toBe(40000);
    expect(without.ltcgOthTax).toBe(25000);
  });

  it("capital gains tax is identical under both regimes", () => {
    const r = compute(buildInput({ cg: { ltcgEq: "500000", stcgEq: "200000" } }));
    expect(r.oldTotal - r.oldR.total).toBe(r.cgTotal);
    expect(r.newTotal - r.newR.total).toBe(r.cgTotal);
  });
});

describe("compute - deductions", () => {
  it("80C is capped at Rs.1,50,000 even if more is entered", () => {
    const r = compute(buildInput({ ded: { c80: "500000" } }));
    expect(r.c80).toBe(150000);
  });

  it("80D self limit is Rs.25,000 normally, Rs.50,000 for senior citizens", () => {
    const normal = compute(buildInput({ ded: { dSelf: "60000", selfSr: false } }));
    const senior = compute(buildInput({ ded: { dSelf: "60000", selfSr: true } }));
    expect(normal.dSelf).toBe(25000);
    expect(senior.dSelf).toBe(50000);
  });

  it("80TTA: non-senior gets up to Rs.10,000 of savings interest only", () => {
    const r = compute(buildInput({ other: { savInt: "15000", fdInt: "20000" }, ded: { selfSr: false } }));
    expect(r.tta).toBe(10000);
  });

  it("80TTB: senior citizen gets up to Rs.50,000 of savings+FD interest combined", () => {
    const r = compute(buildInput({ other: { savInt: "15000", fdInt: "20000" }, ded: { selfSr: true } }));
    expect(r.tta).toBe(35000);
  });

  it("New Regime only allows NPS deductions, not 80C/80D/etc.", () => {
    const r = compute(buildInput({ ded: { c80: "150000", dSelf: "25000", nps: "50000", empNPS: "60000" } }));
    expect(r.dedNew).toBe(110000); // nps + empNPS only
    expect(r.dedOld).toBeGreaterThan(r.dedNew); // Old includes 80C/80D too
  });
});

describe("compute - ITR form selection", () => {
  it("defaults to ITR-1 for plain salary income", () => {
    const r = compute(buildInput({ employers: [{ ...mkState().employers[0], gross: "800000" }] }));
    expect(r.itrForm).toBe("ITR-1");
  });

  it("ITR-3 when there is any business income", () => {
    const r = compute(buildInput({ biz: { type: "business", income: "500000" } }));
    expect(r.itrForm).toBe("ITR-3");
  });

  it("ITR-2 when there are capital gains", () => {
    const r = compute(buildInput({ cg: { ltcgEq: "50000" } }));
    expect(r.itrForm).toBe("ITR-2");
  });

  it("ITR-2 when house property is let-out (not self-occupied)", () => {
    const r = compute(buildInput({ house: { selfOccupied: false } }));
    expect(r.itrForm).toBe("ITR-2");
  });

  it("ITR-2 when the taxpayer is a company director", () => {
    const r = compute(buildInput({ profile: { isDirector: true } }));
    expect(r.itrForm).toBe("ITR-2");
  });

  it("business income takes priority over capital-gains-only ITR-2 triggers", () => {
    const r = compute(buildInput({ biz: { type: "professional", income: "300000" }, cg: { ltcgEq: "50000" } }));
    expect(r.itrForm).toBe("ITR-3");
  });
});

describe("compute - regime recommendation", () => {
  it("recommends whichever regime has the lower total tax", () => {
    const r = compute(buildInput({ employers: [{ ...mkState().employers[0], gross: "1500000" }] }));
    expect(r.rec).toBe(r.oldTotal <= r.newTotal ? "old" : "new");
    expect(r.saving).toBe(Math.abs(r.oldTotal - r.newTotal));
  });
});

describe("compute - TDS, payable/refund", () => {
  it("computes payable when credits are less than tax due, refund when more", () => {
    const r = compute(buildInput({
      employers: [{ ...mkState().employers[0], gross: "1500000" }],
      tds: { employer: "50000" },
    }));
    expect(r.oldPayable).toBe(Math.max(0, r.oldTotal - r.paid));
    expect(r.oldRefund).toBe(Math.max(0, r.paid - r.oldTotal));
    // can't be both payable and refund at once
    expect(r.oldPayable === 0 || r.oldRefund === 0).toBe(true);
  });

  it("Section 234B estimate triggers only when credits are below 90% of tax due and tax exceeds Rs.10,000", () => {
    const r = compute(buildInput({
      employers: [{ ...mkState().employers[0], gross: "1500000" }],
      tds: { employer: "0" },
    }));
    expect(r.i234B).toBeGreaterThan(0);

    const fullyPaid = compute(buildInput({
      employers: [{ ...mkState().employers[0], gross: "1500000" }],
      tds: { employer: "300000" },
    }));
    expect(fullyPaid.i234B).toBe(0);
  });
});
