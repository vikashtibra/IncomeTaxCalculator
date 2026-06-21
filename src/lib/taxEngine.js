// -- TAX ENGINE FY 2025-26 / AY 2026-27 -------------------------------------
// Pure functions only - no side-effecting imports, so this module is safe to
// import in isolation (e.g. for tests) without pulling in Supabase/pdfjs/etc.
export const OLD_SLABS = [
  { min:0,      max:250000,  rate:0    },
  { min:250001, max:500000,  rate:0.05 },
  { min:500001, max:1000000, rate:0.20 },
  { min:1000001,max:Infinity,rate:0.30 },
];
export const NEW_SLABS = [
  { min:0,       max:400000,  rate:0    },
  { min:400001,  max:800000,  rate:0.05 },
  { min:800001,  max:1200000, rate:0.10 },
  { min:1200001, max:1600000, rate:0.15 },
  { min:1600001, max:2000000, rate:0.20 },
  { min:2000001, max:2400000, rate:0.25 },
  { min:2400001, max:Infinity,rate:0.30 },
];

export const pn = v => Math.max(0, parseFloat(String(v||"").replace(/,/g,""))||0);
export const fmt = v => "Rs." + Math.round(Math.abs(v||0)).toLocaleString("en-IN");

export function slabTax(income, slabs) {
  if (income <= 0) return 0;
  let tax = 0;
  for (const s of slabs) {
    if (income < s.min) break;
    tax += (Math.min(income, s.max) - s.min + 1) * s.rate;
  }
  return Math.max(0, tax);
}

export function calcRegime(taxable, regime) {
  const base = slabTax(taxable, regime === "old" ? OLD_SLABS : NEW_SLABS);
  // Rebate 87A: OLD = Rs.12500 if <=5L | NEW = Rs.60000 if <=12L (Budget 2025)
  const rebate = regime === "new"
    ? (taxable <= 1200000 ? Math.min(base, 60000) : 0)
    : (taxable <= 500000  ? Math.min(base, 12500)  : 0);
  const afterRebate = Math.max(0, base - rebate);
  // Surcharge: NEW regime max 25% | OLD regime up to 37%
  let sur = 0;
  if (regime === "new") {
    if      (taxable > 20000000) sur = afterRebate * 0.25;
    else if (taxable > 10000000) sur = afterRebate * 0.15;
    else if (taxable > 5000000)  sur = afterRebate * 0.10;
  } else {
    if      (taxable > 50000000) sur = afterRebate * 0.37;
    else if (taxable > 20000000) sur = afterRebate * 0.25;
    else if (taxable > 10000000) sur = afterRebate * 0.15;
    else if (taxable > 5000000)  sur = afterRebate * 0.10;
  }
  const cess = (afterRebate + sur) * 0.04;
  return {
    base:       Math.round(base),
    rebate:     Math.round(rebate),
    afterRebate:Math.round(afterRebate),
    surcharge:  Math.round(sur),
    cess:       Math.round(cess),
    total:      Math.round(afterRebate + sur + cess),
  };
}

export function compute(d) {
  // Salary
  const gross   = d.employers.reduce((s,e) => s+pn(e.gross), 0);
  const stdOld  = gross > 0 ? 50000 : 0;
  const stdNew  = gross > 0 ? 75000 : 0;
  const hraCalc = (() => {
    let h = 0;
    d.employers.forEach(e => {
      const basic=pn(e.basic), da=pn(e.da), hraR=pn(e.hra), rent=pn(d.ded.rentPaid);
      if (basic>0 && hraR>0 && rent>0) {
        const metro = d.ded.hraCity === "metro";
        h += Math.max(0, Math.min(hraR, rent-0.1*(basic+da), (metro?0.5:0.4)*(basic+da)));
      }
    });
    return h;
  })();
  const hraEx   = d.ded.hraOverride ? pn(d.ded.hraOverride) : hraCalc;
  const ltaEx   = pn(d.ded.lta);
  const grat    = pn(d.ded.gratuity);
  const leaveE  = pn(d.ded.leaveEnc);
  const netOld  = Math.max(0, gross - stdOld - hraEx - ltaEx - grat - leaveE);
  const netNew  = Math.max(0, gross - stdNew);

  // House property
  const loanInt = pn(d.house.loanInt);
  let hpOld, hpNew;
  if (d.house.selfOccupied) {
    hpOld = -Math.min(loanInt, 200000);
    hpNew = 0;
  } else {
    const nav = Math.max(0, pn(d.house.rent) - pn(d.house.munTax));
    const raw = nav - nav*0.3 - loanInt;
    hpOld = raw < -200000 ? -200000 : raw;
    hpNew = hpOld; // let-out allowed in new regime too
  }

  // Capital gains (after set-off Sec 70-74)
  let ltcgEq=pn(d.cg.ltcgEq), stcgEq=pn(d.cg.stcgEq);
  const ltcgOth=pn(d.cg.ltcgOth), stcgOth=pn(d.cg.stcgOth), debtMF=pn(d.cg.debtMF);
  if (stcgEq < 0) { ltcgEq = ltcgEq + stcgEq; stcgEq = 0; }
  if (ltcgEq < 0) ltcgEq = 0;
  const ltcgEqTax  = ltcgEq > 100000 ? Math.round((ltcgEq-100000)*0.125) : 0;
  const stcgEqTax  = Math.round(Math.max(0,stcgEq)*0.20);
  const ltcgOthTax = Math.round(Math.max(0,ltcgOth) * (d.cg.useIndexation ? 0.20 : 0.125));
  const cgSpecial  = ltcgEqTax + stcgEqTax + ltcgOthTax;
  const cgTotal    = cgSpecial + Math.round(cgSpecial*0.04);

  // Business
  const bizInc = pn(d.biz.income);

  // Other income
  const savInt = pn(d.other.savInt);
  const fdInt  = pn(d.other.fdInt);
  const divInc = pn(d.other.dividend);
  const othMisc= pn(d.other.other);
  const totalOth = savInt + fdInt + divInc + othMisc;

  // GTI
  const gtiOld = netOld + hpOld + bizInc + Math.max(0,stcgOth) + debtMF + totalOth;
  const gtiNew = netNew + hpNew + bizInc + Math.max(0,stcgOth) + debtMF + totalOth;

  // Deductions
  const c80   = Math.min(pn(d.ded.c80), 150000);
  const nps   = Math.min(pn(d.ded.nps), 50000);
  const empNPS= pn(d.ded.empNPS);
  const dSelf = Math.min(pn(d.ded.dSelf), d.ded.selfSr ? 50000 : 25000);
  const dPar  = Math.min(pn(d.ded.dParent), d.ded.parentSr ? 50000 : 25000);
  // 80G (simplified - user enters net deductible amount)
  const g80   = pn(d.ded.g80);
  const e80   = pn(d.ded.e80);
  const ee80  = Math.min(pn(d.ded.ee80), 50000);
  const eea80 = Math.min(pn(d.ded.eea80), 150000);
  const tta   = d.ded.selfSr ? Math.min(savInt+fdInt, 50000) : Math.min(savInt, 10000);
  const dedOld = c80+nps+empNPS+dSelf+dPar+g80+e80+ee80+eea80+tta;
  const dedNew = nps+empNPS;

  const taxOld = Math.max(0, gtiOld - dedOld);
  const taxNew = Math.max(0, gtiNew - dedNew);

  const oldR = calcRegime(taxOld, "old");
  const newR = calcRegime(taxNew, "new");
  const oldTotal = oldR.total + cgTotal;
  const newTotal = newR.total + cgTotal;

  const tdsEmp  = pn(d.tds.employer);
  const tdsOth  = pn(d.tds.other);
  const advTax  = pn(d.tds.advance);
  const paid    = tdsEmp + tdsOth + advTax;

  // 234B interest estimate
  const recTotal = oldTotal <= newTotal ? oldTotal : newTotal;
  const i234B = (paid < recTotal*0.90 && recTotal > 10000)
    ? Math.round((recTotal - paid) * 0.01 * 4) : 0;

  const rec = oldTotal <= newTotal ? "old" : "new";

  // ITR form
  let itrForm = "ITR-1";
  if (bizInc > 0 || d.biz.type !== "none") itrForm = "ITR-3";
  else if (ltcgEq>0||stcgEq>0||ltcgOth>0||stcgOth>0||!d.house.selfOccupied||gross>5000000||d.profile.isDirector||d.profile.hasUnlisted||divInc>1000000) itrForm = "ITR-2";

  return {
    gross, stdOld, stdNew, hraCalc, hraEx, ltaEx, grat, leaveE,
    netOld, netNew, hpOld, hpNew, bizInc, savInt, fdInt, divInc, othMisc, totalOth,
    gtiOld, gtiNew,
    c80, nps, empNPS, dSelf, dPar, g80, e80, ee80, eea80, tta,
    dedOld, dedNew, taxOld, taxNew,
    ltcgEq, stcgEq, ltcgOth, stcgOth, debtMF,
    ltcgEqTax, stcgEqTax, ltcgOthTax, cgSpecial, cgTotal,
    oldR, newR, oldTotal, newTotal,
    tdsEmp, tdsOth, advTax, paid,
    oldPayable: Math.max(0, oldTotal-paid),
    newPayable: Math.max(0, newTotal-paid),
    oldRefund:  Math.max(0, paid-oldTotal),
    newRefund:  Math.max(0, paid-newTotal),
    rec, saving: Math.abs(oldTotal-newTotal),
    itrForm, i234B,
    form10IEA: bizInc>0 && rec==="old",
  };
}

// -- INITIAL STATE -----------------------------------------------------------
export const mkEmp = () => ({ name:"", gross:"", basic:"", da:"", hra:"", tds:"" });
export const mkState = () => ({
  tosAgreed: false,
  profile: { name:"", pan:"", dob:"", email:"", phone:"", ifsc:"", accountNo:"", isDirector:false, hasUnlisted:false },
  employers: [mkEmp()],
  house: { selfOccupied:true, rent:"", munTax:"", loanInt:"" },
  cg: { ltcgEq:"", stcgEq:"", ltcgOth:"", stcgOth:"", debtMF:"", useIndexation:false },
  biz: { income:"", type:"none" },
  other: { savInt:"", fdInt:"", dividend:"", other:"" },
  ded: {
    c80:"", nps:"", empNPS:"", govtEmp:false,
    dSelf:"", dParent:"", parentSr:false, selfSr:false,
    hraCity:"metro", rentPaid:"", hraOverride:"",
    lta:"", g80:"", e80:"", ee80:"", eea80:"", gratuity:"", leaveEnc:"",
  },
  tds: { employer:"", other:"", advance:"" },
});
