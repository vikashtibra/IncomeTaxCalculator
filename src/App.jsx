import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";

// -- TAX ENGINE FY 2025-26 / AY 2026-27 -------------------------------------
const OLD_SLABS = [
  { min:0,      max:250000,  rate:0    },
  { min:250001, max:500000,  rate:0.05 },
  { min:500001, max:1000000, rate:0.20 },
  { min:1000001,max:Infinity,rate:0.30 },
];
const NEW_SLABS = [
  { min:0,       max:300000,  rate:0    },
  { min:300001,  max:700000,  rate:0.05 },
  { min:700001,  max:1000000, rate:0.10 },
  { min:1000001, max:1200000, rate:0.15 },
  { min:1200001, max:1500000, rate:0.20 },
  { min:1500001, max:Infinity,rate:0.30 },
];

const pn = v => Math.max(0, parseFloat(String(v||"").replace(/,/g,""))||0);
const fmt = v => "Rs." + Math.round(Math.abs(v||0)).toLocaleString("en-IN");

function slabTax(income, slabs) {
  if (income <= 0) return 0;
  let tax = 0;
  for (const s of slabs) {
    if (income < s.min) break;
    tax += (Math.min(income, s.max) - s.min + 1) * s.rate;
  }
  return Math.max(0, tax);
}

function calcRegime(taxable, regime) {
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

function compute(d) {
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
  let hpOld = 0, hpNew = 0;
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
const mkEmp = () => ({ name:"", gross:"", basic:"", da:"", hra:"", tds:"" });
const mkState = () => ({
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

const STEPS = [
  { id:"tos",     label:"Terms"       },
  { id:"auth",    label:"Login"       },
  { id:"profile", label:"Profile"     },
  { id:"salary",  label:"Salary"      },
  { id:"house",   label:"Property"    },
  { id:"cg",      label:"Cap. Gains"  },
  { id:"biz",     label:"Business"    },
  { id:"other",   label:"Other Inc."  },
  { id:"ded",     label:"Deductions"  },
  { id:"tds",     label:"TDS"         },
  { id:"results", label:"Results"     },
];

// -- ROOT APP ----------------------------------------------------------------
export default function App() {
  const [auth, setAuth]     = useState(null);
  const [ready, setReady]   = useState(false);
  const [step, setStep]     = useState("tos");
  const [data, setData]     = useState(mkState);
  const [toast, setToast]   = useState("");
  const [modal, setModal]   = useState(null); // { type, title, content }
  const [pasteModal, setPasteModal] = useState(false);

  const userToAuth = u => u && { id: u.id, email: u.email, name: u.user_metadata?.name || "" };

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setAuth(userToAuth(session?.user));
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(userToAuth(session?.user));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!auth) return;
    (async () => {
      try {
        const { data: row } = await supabase.from("tax_data").select("data").eq("user_id", auth.id).maybeSingle();
        if (row && row.data) setData(prev => ({ ...mkState(), ...row.data }));
      } catch { /* no saved data yet */ }
      setStep("profile");
    })();
  }, [auth]);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const saveSession = async d => {
    if (!auth) return;
    try {
      const { error } = await supabase.from("tax_data").upsert({
        user_id: auth.id, data: d || data, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      showToast("Saved");
    } catch (e) {
      showToast("Save failed: " + (e && e.message ? e.message : "unknown error"));
    }
  };

  const setF = (path, val) => setData(prev => {
    const next = JSON.parse(JSON.stringify(prev));
    const keys = path.split(".");
    let obj = next;
    for (let i=0; i<keys.length-1; i++) obj = obj[keys[i]];
    obj[keys[keys.length-1]] = val;
    return next;
  });

  const setEmp = (i,k,v) => setData(prev => {
    const next = JSON.parse(JSON.stringify(prev));
    next.employers[i][k] = v;
    return next;
  });

  const r = compute(data);

  const stepIdx = STEPS.findIndex(s => s.id === step);
  const goNext  = () => { const i = STEPS.findIndex(s=>s.id===step); if (i<STEPS.length-1) setStep(STEPS[i+1].id); };
  const goPrev  = () => { const i = STEPS.findIndex(s=>s.id===step); if (i>0) setStep(STEPS[i-1].id); };
  const goTo    = id  => setStep(id);

  const exportSession = () => {
    const session = { _type:"TaxFilerIndia_Session", _v:"2.0", _at:new Date().toISOString(), _user:auth, data };
    setModal({ type:"copy", title:"Session Backup - Copy & Save", filename:"TaxFiler_Session.json", content:JSON.stringify(session, null, 2) });
  };

  const importSession = text => {
    try {
      const s = JSON.parse(text);
      if (s._type !== "TaxFilerIndia_Session") { showToast("Invalid session file"); return false; }
      if (!auth) { showToast("Log in or register first, then import"); return false; }
      if (s.data) setData({ ...mkState(), ...s.data });
      setStep("profile");
      showToast("Session imported");
      return true;
    } catch { showToast("Invalid JSON"); return false; }
  };

  const buildReport = () => {
    const reg = r.rec, regime = reg==="old"?r.oldR:r.newR;
    const net = reg==="old"?r.oldTotal:r.newTotal;
    const pay = reg==="old"?r.oldPayable:r.newPayable;
    const ref = reg==="old"?r.oldRefund:r.newRefund;
    const ded = reg==="old"?r.dedOld:r.dedNew;
    const tax = reg==="old"?r.taxOld:r.taxNew;
    const rw = (l,v) => l.padEnd(36)+fmt(v);
    return [
      "====================================================",
      "     INCOME TAX COMPUTATION - FY 2025-26",
      "====================================================",
      "Name   : "+(data.profile.name||"-"),
      "PAN    : "+(data.profile.pan||"-"),
      "Form   : "+r.itrForm+"  Regime: "+reg.toUpperCase(),
      "Date   : "+new Date().toLocaleDateString("en-IN"),
      "",
      "-- INCOME SUMMARY ----------------------------------",
      rw("Gross Salary",r.gross),
      rw("(-) Std Deduction",reg==="old"?r.stdOld:r.stdNew),
      rw("(-) HRA/LTA/Gratuity",r.hraEx+r.ltaEx+r.grat+r.leaveE),
      rw("Net Salary",reg==="old"?r.netOld:r.netNew),
      rw("House Property",reg==="old"?r.hpOld:r.hpNew),
      rw("Business Income",r.bizInc),
      rw("Other Income",r.totalOth),
      rw("Gross Total Income",reg==="old"?r.gtiOld:r.gtiNew),
      "",
      "-- DEDUCTIONS ("+reg.toUpperCase()+") -------------------------",
      rw("Total Deductions",ded),
      rw("Taxable Income",tax),
      "",
      "-- TAX COMPUTATION ---------------------------------",
      rw("Base Tax",regime.base),
      rw("(-) Rebate 87A",regime.rebate),
      rw("(+) Surcharge",regime.surcharge),
      rw("(+) Cess 4%",regime.cess),
      rw("(+) Capital Gains Tax",r.cgTotal),
      rw("Total Tax",net),
      rw("(-) TDS + Advance Tax",r.paid),
      "----------------------------------------------------",
      ref>0 ? rw("** REFUND **",ref) : rw("** TAX PAYABLE **",pay),
      "",
      "-- REGIME COMPARISON --------------------------------",
      rw("Old Regime",r.oldTotal),
      rw("New Regime",r.newTotal),
      rw("Saving ("+reg.toUpperCase()+" wins)",r.saving),
      "",
      "====================================================",
      "DISCLAIMER: Reference only. Verify with CA before",
      "filing. Platform holds no liability for errors.",
      "====================================================",
    ].join("\n");
  };

  const buildJSON = () => JSON.stringify({
    _meta:{ tool:"TaxFiler India", date:new Date().toISOString(), disclaimer:"Reference only" },
    ITRForm:r.itrForm, AY:"2026-27",
    PersonalInfo:{ ...data.profile, ResStatus:"RESIDENT" },
    Income:{ Gross:r.gross, NetSalaryOld:r.netOld, NetSalaryNew:r.netNew, HP_Old:r.hpOld, HP_New:r.hpNew, Business:r.bizInc, OtherIncome:r.totalOth, GTI_Old:r.gtiOld, GTI_New:r.gtiNew },
    CapitalGains:{ LTCG_Eq:r.ltcgEq, STCG_Eq:r.stcgEq, LTCG_Oth:r.ltcgOth, CG_Tax:r.cgTotal },
    Deductions:{ "80C":r.c80, NPS:r.nps, EmpNPS:r.empNPS, "80D":r.dSelf+r.dPar, "80G":r.g80, "80TTA":r.tta, TotalOld:r.dedOld, TotalNew:r.dedNew },
    Tax:{ Taxable_Old:r.taxOld, Taxable_New:r.taxNew, OldRegime:{ ...r.oldR, Total:r.oldTotal }, NewRegime:{ ...r.newR, Total:r.newTotal }, Recommended:r.rec.toUpperCase(), Saving:r.saving, TDSPaid:r.paid, Payable_Old:r.oldPayable, Payable_New:r.newPayable, Refund_Old:r.oldRefund, Refund_New:r.newRefund },
    Form10IEA:r.form10IEA,
  }, null, 2);

  if (!ready) return <Loading />;

  const isAuthStep = step === "tos" || step === "auth";
  const P = { data, setF, setEmp, r, goNext, goPrev, goTo, auth, setAuth, saveSession, showToast, exportSession, setPasteModal };

  return (
    <div style={S.app}>
      <style>{CSS}</style>

      <header style={S.header}>
        <div style={S.hL}>
          {!isAuthStep && (
            <button style={S.menuBtn} onClick={() => setStep(step)}>
              <span style={{ fontSize:18 }}>{STEPS[stepIdx]?.label || "Menu"}</span>
            </button>
          )}
          <div style={S.brand}>
            <div style={S.logo}>Rs</div>
            <div>
              <div style={S.brandName}>TaxFiler India</div>
              <div style={S.brandSub}>FY 2025-26 / AY 2026-27</div>
            </div>
          </div>
        </div>
        <div style={S.hR}>
          {toast && <span style={S.toast}>{toast}</span>}
          {auth && !isAuthStep && (
            <>
              <button style={S.hBtn} onClick={() => saveSession()}>Save</button>
              <button style={S.hBtn} onClick={exportSession}>Backup</button>
              <button style={S.hBtn} onClick={() => setPasteModal("import")}>Restore</button>
              <div style={S.avatar}>{(auth.name||auth.email)[0].toUpperCase()}</div>
            </>
          )}
        </div>
      </header>

      {!isAuthStep && (
        <>
          <div style={S.progBg}>
            <div style={{ ...S.progFill, width: Math.max(2,((stepIdx-1)/(STEPS.length-2))*100)+"%" }} />
          </div>
          <div style={S.stepTabs}>
            {STEPS.filter(s=>s.id!=="tos"&&s.id!=="auth").map(s => (
              <button key={s.id} style={{ ...S.stepTab, ...(step===s.id?S.stepTabOn:{}) }} onClick={() => goTo(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div style={S.liveBanner}>
            <span>Income: <b>{fmt(r.gtiOld)}</b></span>
            <span>Old: <b style={{color:r.rec==="old"?"#16a34a":"#dc2626"}}>{fmt(r.oldTotal)}</b></span>
            <span>New: <b style={{color:r.rec==="new"?"#16a34a":"#dc2626"}}>{fmt(r.newTotal)}</b></span>
            <span style={{color:"#16a34a",fontWeight:700}}>{r.rec.toUpperCase()} saves {fmt(r.saving)}</span>
          </div>
        </>
      )}

      <main style={S.main}>
        {step==="tos"     && <TOSScreen     {...P} />}
        {step==="auth"    && <AuthScreen    {...P} importSession={importSession} />}
        {step==="profile" && <ProfileScreen {...P} />}
        {step==="salary"  && <SalaryScreen  {...P} />}
        {step==="house"   && <HouseScreen   {...P} />}
        {step==="cg"      && <CGScreen      {...P} />}
        {step==="biz"     && <BizScreen     {...P} />}
        {step==="other"   && <OtherScreen   {...P} />}
        {step==="ded"     && <DedScreen     {...P} />}
        {step==="tds"     && <TDSScreen     {...P} />}
        {step==="results" && <ResultsScreen {...P} setModal={setModal} buildReport={buildReport} buildJSON={buildJSON} />}
      </main>

      {!isAuthStep && (
        <nav style={S.botNav}>
          <button style={{ ...S.navBtn, opacity:stepIdx<=2?0.3:1 }} disabled={stepIdx<=2} onClick={goPrev}>Back</button>
          <span style={S.navLabel}>{STEPS[stepIdx]?.label}</span>
          <button style={{ ...S.navBtn, background:"#1B4FD8", color:"#fff" }} onClick={goNext} disabled={stepIdx>=STEPS.length-1}>
            {stepIdx>=STEPS.length-1?"Done":"Next"}
          </button>
        </nav>
      )}

      {modal && (
        <CopyModal title={modal.title} content={modal.content} onClose={() => setModal(null)} />
      )}

      {pasteModal && (
        <PasteModal
          title={pasteModal==="import" ? "Paste Session Backup JSON" : "Paste Document Text"}
          hint="Open your backup .json in Notepad, select all (Ctrl+A), copy (Ctrl+C), paste here"
          onClose={() => setPasteModal(false)}
          onSubmit={text => { if (importSession(text)) setPasteModal(false); }}
        />
      )}
    </div>
  );
}

// -- SCREENS ------------------------------------------------------------------

function TOSScreen({ setF, data, goNext }) {
  return (
    <Page title="Terms of Service">
      <div style={S.tosBox}>
        <b style={{fontSize:13}}>TaxFiler India - Liability Disclaimer</b>
        {[
          ["1. Reference Tool Only","This tool is for reference only. It does NOT constitute professional tax or legal advice. Verify all results with a qualified Chartered Accountant before filing."],
          ["2. No Liability","The platform disclaims ALL liability for incorrect calculations, tax demand notices, penalties, ITR rejection, or any financial loss from using this tool."],
          ["3. Resident Individuals Only","This tool is ONLY for Resident Individuals. It EXCLUDES: NRIs, HUFs, foreign assets/income, Crypto/VDA, companies, LLPs."],
          ["4. Data Privacy","All data is stored locally on your device only. Nothing is sent to any server."],
          ["5. JSON Utility File","The exported JSON is a reference payload only. Verify against the official utility at incometax.gov.in before uploading."],
          ["6. Tax Law Changes","While this covers FY 2025-26 rules, always consult incometax.gov.in for current provisions."],
        ].map(([h,b]) => (
          <div key={h} style={{marginBottom:10}}>
            <div style={{fontWeight:700,fontSize:12,marginBottom:3}}>{h}</div>
            <p style={{fontSize:12,color:"#718096",margin:0,lineHeight:1.6}}>{b}</p>
          </div>
        ))}
      </div>
      <label style={S.tosCheck}>
        <input type="checkbox" checked={!!data.tosAgreed} onChange={e=>setF("tosAgreed",e.target.checked)} style={{width:18,height:18,accentColor:"#1B4FD8",flexShrink:0}} />
        <span style={{fontSize:13,lineHeight:1.5}}>I have read and accept these Terms. I understand this is a reference tool.</span>
      </label>
      <button style={{...S.btnPri, opacity:data.tosAgreed?1:0.4}} disabled={!data.tosAgreed} onClick={goNext}>
        Accept and Continue
      </button>
    </Page>
  );
}

function AuthScreen({ importSession }) {
  const [mode, setMode]   = useState("login");
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [err, setErr]     = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteErr, setPasteErr]   = useState("");

  async function submit() {
    setErr("");
    if (!email.trim())                              { setErr("Email is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("Enter a valid email"); return; }
    if (pass.length < 6)                            { setErr("Password must be 6+ characters"); return; }
    if (mode === "register" && !name.trim())        { setErr("Full name required"); return; }
    try {
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({
          email, password: pass, options: { data: { name: name.trim() } },
        });
        if (error) { setErr(error.message); return; }
        setErr("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) { setErr(error.message); return; }
      }
    } catch (e) {
      setErr("Auth error: " + (e && e.message ? e.message : "please try again"));
    }
  }

  return (
    <Page title={mode==="login"?"Welcome Back":"Create Account"}>
      <div style={S.authBox}>
        {mode==="register" && <FIn label="Full Name" value={name} onChange={setName} placeholder="Rajesh Kumar" />}
        <FIn label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <FIn label="Password" type="password" value={pass} onChange={setPass} placeholder="Min. 6 characters" onEnter={submit} />
        {err && <div style={S.errBox}>{err}</div>}
        <button style={S.btnPri} onClick={submit}>{mode==="login"?"Sign In":"Create Account"}</button>
        <div style={{textAlign:"center",marginTop:12,fontSize:13,color:"#718096"}}>
          {mode==="login"?"New here?":"Have an account?"}
          <button style={S.linkBtn} onClick={()=>{setMode(m=>m==="login"?"register":"login");setErr("");}}>
            {mode==="login"?" Register":" Sign In"}
          </button>
        </div>
        <div style={{height:1,background:"#E2E8F0",margin:"16px 0"}} />
        <div style={{textAlign:"center",fontSize:12,color:"#718096",marginBottom:8,fontWeight:700}}>
          Moving from another device?
        </div>
        {!showPaste ? (
          <button style={{...S.btnSec}} onClick={()=>setShowPaste(true)}>
            Paste Session Backup JSON
          </button>
        ) : (
          <div>
            <textarea style={S.pasteArea} rows={5}
              placeholder="Paste your TaxFiler_Session.json content here..."
              value={pasteText} onChange={e=>{setPasteText(e.target.value);setPasteErr("");}}
            />
            {pasteErr && <div style={{fontSize:12,color:"#dc2626",marginBottom:6}}>{pasteErr}</div>}
            <div style={{display:"flex",gap:8}}>
              <button style={{...S.btnPri,flex:2,padding:"10px"}} onClick={()=>{
                const ok = importSession(pasteText);
                if (!ok) setPasteErr("Invalid JSON - check you copied the complete file");
              }}>Import Session</button>
              <button style={{...S.btnSec,flex:1,padding:"10px"}} onClick={()=>{setShowPaste(false);setPasteText("");}}>Cancel</button>
            </div>
          </div>
        )}
        <div style={{textAlign:"center",fontSize:11,color:"#94a3b8",marginTop:12,padding:"8px",background:"#F8FAFC",borderRadius:8}}>
          Data stored locally on this device only
        </div>
      </div>
    </Page>
  );
}

function ProfileScreen({ data, setF, exportSession, setPasteModal, auth, showToast }) {
  const pan = data.profile.pan;
  const ifsc = data.profile.ifsc;
  const panOk  = !pan  || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const ifscOk = !ifsc || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
  return (
    <Page title="Profile">
      <Card title="Personal Details">
        <FIn label="Full Name (as on PAN)" value={data.profile.name} onChange={v=>setF("profile.name",v)} placeholder="RAJESH KUMAR" />
        <FIn label="PAN Number" value={data.profile.pan} onChange={v=>setF("profile.pan",v.toUpperCase().slice(0,10))} placeholder="ABCDE1234F" mono />
        {!panOk && <Warn>PAN format: ABCDE1234F</Warn>}
        <FIn label="Date of Birth" type="date" value={data.profile.dob} onChange={v=>setF("profile.dob",v)} />
        <Row2>
          <FIn label="Mobile" type="tel" value={data.profile.phone} onChange={v=>setF("profile.phone",v)} placeholder="9876543210" />
          <FIn label="Email" type="email" value={data.profile.email} onChange={v=>setF("profile.email",v)} placeholder="you@email.com" />
        </Row2>
      </Card>
      <Card title="Bank Details for Refund">
        <FIn label="Account Number" value={data.profile.accountNo} onChange={v=>setF("profile.accountNo",v)} placeholder="123456789012" mono />
        <FIn label="IFSC Code" value={data.profile.ifsc} onChange={v=>setF("profile.ifsc",v.toUpperCase())} placeholder="SBIN0001234" mono />
        {!ifscOk && <Warn>IFSC format: SBIN0001234</Warn>}
      </Card>
      <Card title="ITR Eligibility">
        <Tog label="I am a Director in any company (ITR-2 required)" on={!!data.profile.isDirector} onChange={v=>setF("profile.isDirector",v)} />
        <Tog label="I hold unlisted equity shares (ITR-2 required)" on={!!data.profile.hasUnlisted} onChange={v=>setF("profile.hasUnlisted",v)} />
      </Card>
      <Card title="Multi-Device Transfer">
        <p style={{fontSize:12,color:"#718096",margin:"0 0 10px"}}>
          To move your data to another device: click Backup, copy the full JSON text, open the app on the new device, click Restore on the login screen and paste it.
        </p>
        <div style={{display:"flex",gap:8}}>
          <button style={{...S.btnPri,flex:1,fontSize:13}} onClick={exportSession}>Backup Session</button>
          <button style={{...S.btnSec,flex:1,fontSize:13}} onClick={()=>setPasteModal("import")}>Restore Session</button>
        </div>
      </Card>
      {auth && (
        <button style={{...S.btnSec,color:"#dc2626",borderColor:"#FECACA"}} onClick={async()=>{
          await supabase.auth.signOut();
          showToast("Logged out");
        }}>Logout</button>
      )}
      <Info>Resident Individuals only. NRIs, HUFs, foreign income and Crypto are excluded.</Info>
    </Page>
  );
}

function SalaryScreen({ data, setF, setEmp, r }) {
  const addEmp    = () => setF("employers", [...data.employers, mkEmp()]);
  const removeEmp = i => setF("employers", data.employers.filter((_,j)=>j!==i));
  return (
    <Page title="Salary Income">
      {data.employers.map((emp,i) => (
        <Card key={i} title={"Employer "+(i+1)+(emp.name?" - "+emp.name:"")} onRemove={i>0?()=>removeEmp(i):null}>
          <FIn label="Company Name" value={emp.name} onChange={v=>setEmp(i,"name",v)} placeholder="ABC Pvt Ltd" />
          <Row2>
            <FIn label="Gross Salary (Annual)" type="number" value={emp.gross} onChange={v=>setEmp(i,"gross",v)} placeholder="1200000" mono />
            <FIn label="Basic Salary (Annual)" type="number" value={emp.basic} onChange={v=>setEmp(i,"basic",v)} placeholder="600000" mono />
          </Row2>
          <Row2>
            <FIn label="HRA Received" type="number" value={emp.hra} onChange={v=>setEmp(i,"hra",v)} placeholder="200000" mono />
            <FIn label="DA Received" type="number" value={emp.da} onChange={v=>setEmp(i,"da",v)} placeholder="0" mono />
          </Row2>
          <FIn label="TDS by this Employer" type="number" value={emp.tds} onChange={v=>setEmp(i,"tds",v)} placeholder="80000" mono />
        </Card>
      ))}
      <button style={S.addBtn} onClick={addEmp}>+ Add Another Employer</button>
      {r.gross > 0 && (
        <div style={S.liveBox}>
          <span>Gross: <b>{fmt(r.gross)}</b></span>
          <span>Std Ded (Old): <b>-{fmt(r.stdOld)}</b></span>
          <span>Std Ded (New): <b>-{fmt(r.stdNew)}</b></span>
        </div>
      )}
      <Info>Standard Deduction: Rs.50,000 (Old Regime) / Rs.75,000 (New Regime). Auto-applied.</Info>
    </Page>
  );
}

function HouseScreen({ data, setF, r }) {
  const d = data.house;
  return (
    <Page title="House Property">
      <Card title="Property Details">
        <Tog label="Self-Occupied Property (no rental income)" on={d.selfOccupied} onChange={v=>setF("house.selfOccupied",v)} />
        {!d.selfOccupied && (
          <Row2>
            <FIn label="Annual Rent Received" type="number" value={d.rent} onChange={v=>setF("house.rent",v)} placeholder="240000" mono />
            <FIn label="Municipal Tax Paid" type="number" value={d.munTax} onChange={v=>setF("house.munTax",v)} placeholder="12000" mono />
          </Row2>
        )}
        <FIn label={d.selfOccupied?"Home Loan Interest (max Rs.2L, Old Regime)":"Home Loan Interest (no limit for let-out)"}
          type="number" value={d.loanInt} onChange={v=>setF("house.loanInt",v)} placeholder="150000" mono />
        {r.hpOld !== 0 && (
          <div style={S.liveBox}>
            <span>HP Income (Old): <b style={{color:r.hpOld<0?"#dc2626":"#16a34a"}}>{fmt(r.hpOld)}{r.hpOld<0?" (loss)":""}</b></span>
          </div>
        )}
      </Card>
      <Info>For let-out: 30% standard deduction on NAV auto-applied. HP loss capped at Rs.2L against other income (Sec 71(3A)).</Info>
    </Page>
  );
}

function CGScreen({ data, setF, r }) {
  const d = data.cg;
  return (
    <Page title="Capital Gains">
      <Card title="Equity and Equity Mutual Funds">
        <FIn label="LTCG (held over 1 year) - 12.5% above Rs.1L" type="number" value={d.ltcgEq} onChange={v=>setF("cg.ltcgEq",v)} placeholder="0" mono />
        <FIn label="STCG (held under 1 year) - flat 20%" type="number" value={d.stcgEq} onChange={v=>setF("cg.stcgEq",v)} placeholder="0" mono />
        {(r.ltcgEqTax>0||r.stcgEqTax>0) && (
          <div style={S.liveBox}>
            <span>LTCG Tax: <b>{fmt(r.ltcgEqTax)}</b></span>
            <span>STCG Tax: <b>{fmt(r.stcgEqTax)}</b></span>
          </div>
        )}
      </Card>
      <Card title="Other Assets - Property, Gold">
        <FIn label="LTCG on Other Assets" type="number" value={d.ltcgOth} onChange={v=>setF("cg.ltcgOth",v)} placeholder="0" mono />
        <Tog label="Use 20% with indexation (for property acquired before 23-Jul-2024)" on={!!d.useIndexation} onChange={v=>setF("cg.useIndexation",v)} />
        <FIn label="STCG on Other Assets (added to normal income at slab rate)" type="number" value={d.stcgOth} onChange={v=>setF("cg.stcgOth",v)} placeholder="0" mono />
        <FIn label="Debt MF / Bond Fund gains (slab rate, post Apr 2023)" type="number" value={d.debtMF} onChange={v=>setF("cg.debtMF",v)} placeholder="0" mono />
      </Card>
      {r.cgTotal > 0 && (
        <div style={S.liveBox}><span>Total Capital Gains Tax: <b>{fmt(r.cgTotal)}</b></span></div>
      )}
      <Info>LTCG on equity: first Rs.1,00,000 per year is exempt. Get Capital Gains Statement from CAMS / broker for exact figures.</Info>
    </Page>
  );
}

function BizScreen({ data, setF, r }) {
  const d = data.biz;
  return (
    <Page title="Business / Professional Income">
      <Card title="Income Type">
        <div style={S.segRow}>
          {[["none","Not Applicable"],["professional","Professional (44ADA)"],["business","Business (44AD)"]].map(([v,l])=>(
            <button key={v} style={{...S.seg,...(d.type===v?S.segOn:{})}} onClick={()=>setF("biz.type",v)}>{l}</button>
          ))}
        </div>
        {d.type !== "none" && (
          <>
            <FIn label={d.type==="professional"?"Net Professional Income (min 50% of gross)":"Net Business Income (min 6%/8% of turnover)"}
              type="number" value={d.income} onChange={v=>setF("biz.income",v)} placeholder="400000" mono />
            <p style={{fontSize:11,color:"#718096",margin:"0 0 8px"}}>
              {d.type==="professional"?"Sec 44ADA: Doctors, lawyers, CAs, engineers. Gross receipts up to Rs.75L.":"Sec 44AD: Small business. Turnover up to Rs.2Cr. 6% digital / 8% cash."}
            </p>
          </>
        )}
      </Card>
      {d.type !== "none" && r.form10IEA && <Warn>Form 10-IEA required: Business income with Old Regime selected. Auto-included in JSON export.</Warn>}
    </Page>
  );
}

function OtherScreen({ data, setF, r }) {
  const d = data.other;
  return (
    <Page title="Other Income">
      <Card title="Interest and Dividend Income">
        <FIn label="Savings Account Interest" type="number" value={d.savInt} onChange={v=>setF("other.savInt",v)} placeholder="8000" mono />
        <FIn label="Fixed Deposit Interest (full gross, before TDS)" type="number" value={d.fdInt} onChange={v=>setF("other.fdInt",v)} placeholder="25000" mono />
        <FIn label="Dividend Income" type="number" value={d.dividend} onChange={v=>setF("other.dividend",v)} placeholder="0" mono />
        <FIn label="Other Income (gifts over Rs.50K, winnings, etc.)" type="number" value={d.other} onChange={v=>setF("other.other",v)} placeholder="0" mono />
      </Card>
      {r.totalOth > 0 && (
        <div style={S.liveBox}>
          <span>Total Other Income: <b>{fmt(r.totalOth)}</b></span>
          <span>80TTA auto-deduction: <b>-{fmt(r.tta)}</b></span>
        </div>
      )}
      <Info>FD interest is fully taxable even if TDS was deducted - enter the full gross amount. 80TTA (savings interest up to Rs.10K) is auto-applied.</Info>
    </Page>
  );
}

function DedScreen({ data, setF, r }) {
  const d = data.ded;
  return (
    <Page title="Deductions">
      <Card title="Taxpayer Category">
        <Tog label="I am a Senior Citizen (60+ years) - raises 80D and 80TTB limits" on={!!d.selfSr} onChange={v=>setF("ded.selfSr",v)} />
        {d.selfSr && <div style={S.liveBox}><span>80TTB: all interest up to Rs.50,000. 80D self-limit: Rs.50,000</span></div>}
      </Card>
      <Card title="80C Investments - max Rs.1,50,000 (Old Regime)">
        <FIn label="Total 80C Amount" type="number" value={d.c80} onChange={v=>setF("ded.c80",v)} placeholder="150000" mono />
        <p style={{fontSize:11,color:"#718096",margin:"0 0 8px"}}>PPF, ELSS, LIC, EPF, NSC, SCSS, Sukanya Samriddhi, 5yr Tax Saver FD, Tuition Fees</p>
        {r.c80 > 0 && <div style={S.liveBox}><span>Applied: <b>{fmt(r.c80)}</b>{pn(d.c80)>150000?" (capped at Rs.1,50,000)":""}</span></div>}
      </Card>
      <Card title="NPS - Both Regimes">
        <FIn label="80CCD(1B) Additional NPS (over 80C) - max Rs.50,000" type="number" value={d.nps} onChange={v=>setF("ded.nps",v)} placeholder="50000" mono />
        <Tog label="Government Employee (14% employer NPS limit)" on={!!d.govtEmp} onChange={v=>setF("ded.govtEmp",v)} />
        <FIn label="80CCD(2) Employer NPS Contribution (Both Regimes)" type="number" value={d.empNPS} onChange={v=>setF("ded.empNPS",v)} placeholder="60000" mono />
        <p style={{fontSize:11,color:"#718096",margin:0}}>Employer NPS: max 10% of Basic+DA (private) or 14% (govt). Available in both regimes.</p>
      </Card>
      <Card title="80D Health Insurance (Old Regime)">
        <Row2>
          <FIn label={"Self/Family (max "+(d.selfSr?"Rs.50K":"Rs.25K")+")"} type="number" value={d.dSelf} onChange={v=>setF("ded.dSelf",v)} placeholder="20000" mono />
          <FIn label="Parents" type="number" value={d.dParent} onChange={v=>setF("ded.dParent",v)} placeholder="25000" mono />
        </Row2>
        <Tog label="Parents are Senior Citizens (60+) - max Rs.50,000" on={!!d.parentSr} onChange={v=>setF("ded.parentSr",v)} />
      </Card>
      <Card title="HRA Exemption (Old Regime)">
        <div style={S.segRow}>
          {[["metro","Metro (Delhi/Mumbai/Chennai/Kolkata) 50%"],["nonmetro","Non-Metro 40%"]].map(([v,l])=>(
            <button key={v} style={{...S.seg,...(d.hraCity===v?S.segOn:{})}} onClick={()=>setF("ded.hraCity",v)}>{l}</button>
          ))}
        </div>
        <FIn label="Annual Rent Paid (for auto-calculation)" type="number" value={d.rentPaid} onChange={v=>setF("ded.rentPaid",v)} placeholder="180000" mono />
        <FIn label="Override HRA Exempt Amount (leave blank for auto)" type="number" value={d.hraOverride} onChange={v=>setF("ded.hraOverride",v)} placeholder="" mono />
        {r.hraCalc > 0 && <div style={S.liveBox}><span>Auto-calc: <b>{fmt(r.hraCalc)}</b> | Applying: <b>{fmt(r.hraEx)}</b></span></div>}
      </Card>
      <Card title="Other Deductions (Old Regime)">
        <Row2>
          <FIn label="LTA Exemption" type="number" value={d.lta} onChange={v=>setF("ded.lta",v)} placeholder="0" mono />
          <FIn label="80G Donations (net deductible amount)" type="number" value={d.g80} onChange={v=>setF("ded.g80",v)} placeholder="0" mono />
        </Row2>
        <Row2>
          <FIn label="80E Education Loan Interest" type="number" value={d.e80} onChange={v=>setF("ded.e80",v)} placeholder="0" mono />
          <FIn label="80EE First Home Loan (max Rs.50K, loan 2016-17)" type="number" value={d.ee80} onChange={v=>setF("ded.ee80",v)} placeholder="0" mono />
        </Row2>
        <FIn label="80EEA First Home Loan (max Rs.1.5L, loan Apr 2019-Mar 2022)" type="number" value={d.eea80} onChange={v=>setF("ded.eea80",v)} placeholder="0" mono />
        {pn(d.ee80)>0 && pn(d.eea80)>0 && <Warn>Cannot claim both 80EE and 80EEA. Remove one.</Warn>}
        <Row2>
          <FIn label="Gratuity Exempt (max Rs.20L)" type="number" value={d.gratuity} onChange={v=>setF("ded.gratuity",v)} placeholder="0" mono />
          <FIn label="Leave Encashment (max Rs.25L)" type="number" value={d.leaveEnc} onChange={v=>setF("ded.leaveEnc",v)} placeholder="0" mono />
        </Row2>
      </Card>
      <div style={S.liveBox}>
        <span>Old Regime Deductions: <b>{fmt(r.dedOld)}</b></span>
        <span>Taxable (Old): <b>{fmt(r.taxOld)}</b></span>
        <span>New Regime Deductions: <b>{fmt(r.dedNew)}</b></span>
        <span>Taxable (New): <b>{fmt(r.taxNew)}</b></span>
      </div>
    </Page>
  );
}

function TDSScreen({ data, setF, r }) {
  const autoTDS = data.employers.reduce((s,e)=>s+pn(e.tds),0);
  return (
    <Page title="TDS and Taxes Paid">
      <Card title="TDS Credits">
        <FIn label="TDS by Employer(s)" type="number" value={data.tds.employer} onChange={v=>setF("tds.employer",v)}
          placeholder={autoTDS>0?String(Math.round(autoTDS)):"80000"} mono />
        {autoTDS>0 && !data.tds.employer && (
          <button style={{...S.btnSec,marginBottom:8,fontSize:12}} onClick={()=>setF("tds.employer",String(Math.round(autoTDS)))}>
            Use {fmt(autoTDS)} from salary entries
          </button>
        )}
        <FIn label="TDS on FD / Rent / Others" type="number" value={data.tds.other} onChange={v=>setF("tds.other",v)} placeholder="0" mono />
      </Card>
      <Card title="Advance Tax">
        <FIn label="Advance Tax Paid (all instalments)" type="number" value={data.tds.advance} onChange={v=>setF("tds.advance",v)} placeholder="0" mono />
      </Card>
      {r.paid > 0 && (
        <div style={S.liveBox}>
          <span>Total Credits: <b>{fmt(r.paid)}</b></span>
          <span>Old {r.oldRefund>0?"Refund":"Payable"}: <b style={{color:r.oldRefund>0?"#16a34a":"#dc2626"}}>{fmt(r.oldRefund>0?r.oldRefund:r.oldPayable)}</b></span>
          <span>New {r.newRefund>0?"Refund":"Payable"}: <b style={{color:r.newRefund>0?"#16a34a":"#dc2626"}}>{fmt(r.newRefund>0?r.newRefund:r.newPayable)}</b></span>
        </div>
      )}
      <Info>Download Form 26AS and AIS from incometax.gov.in to verify all TDS entries. Mismatch can trigger demand notices.</Info>
    </Page>
  );
}

function ResultsScreen({ r, data, setModal, buildReport, buildJSON, exportSession, setPasteModal, goTo }) {
  const [tab, setTab] = useState("compare");
  const reg = r.rec;
  const net = reg==="old"?r.oldTotal:r.newTotal;
  const pay = reg==="old"?r.oldPayable:r.newPayable;
  const ref = reg==="old"?r.oldRefund:r.newRefund;

  return (
    <Page title={"Results - " + r.itrForm}>
      <div style={{...S.recBanner, borderColor:reg==="new"?"#86efac":"#fde68a", background:reg==="new"?"#f0fdf4":"#fffbeb"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <span style={{fontWeight:800,fontSize:15}}>{reg.toUpperCase()} REGIME RECOMMENDED</span>
          <span style={{background:"#16a34a",color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:12,fontWeight:700}}>Save {fmt(r.saving)}</span>
        </div>
        <div style={{fontSize:12,color:"#718096",marginTop:6}}>
          {reg==="new"?"New Regime gives lower tax - simplified slabs outweigh your deductions.":"Old Regime saves more - your deductions exceed the slab advantage."}
        </div>
        {r.form10IEA && <Warn>Form 10-IEA required - auto-included in JSON export</Warn>}
        {r.i234B > 0 && <Warn>{"Interest u/s 234B (estimated): " + fmt(r.i234B) + " - advance tax appears insufficient"}</Warn>}
      </div>

      <div style={S.tabs}>
        {[["compare","Compare"],["breakdown","Breakdown"],["guide","Filing Guide"]].map(([id,lbl])=>(
          <button key={id} style={{...S.tab,...(tab===id?S.tabOn:{})}} onClick={()=>setTab(id)}>{lbl}</button>
        ))}
      </div>

      {tab === "compare" && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <RegCard label="Old Regime" regime={r.oldR} taxable={r.taxOld} ded={r.dedOld}
              cgTotal={r.cgTotal} total={r.oldTotal} paid={r.paid}
              payable={r.oldPayable} refund={r.oldRefund} isRec={r.rec==="old"} />
            <RegCard label="New Regime" regime={r.newR} taxable={r.taxNew} ded={r.dedNew}
              cgTotal={r.cgTotal} total={r.newTotal} paid={r.paid}
              payable={r.newPayable} refund={r.newRefund} isRec={r.rec==="new"} />
          </div>
          <Card title="Capital Gains Tax">
            <TR l="LTCG Equity (above Rs.1L at 12.5%)" v={fmt(r.ltcgEqTax)} />
            <TR l="STCG Equity at 20%" v={fmt(r.stcgEqTax)} />
            <TR l="LTCG Other Assets" v={fmt(r.ltcgOthTax)} />
            <TR l="Total CG Tax (incl. cess)" v={fmt(r.cgTotal)} bold />
          </Card>
        </>
      )}

      {tab === "breakdown" && (
        <>
          <Card title="Income Summary">
            <TR l="Gross Salary" v={fmt(r.gross)} />
            <TR l="(-) Std Deduction - Old/New" v={fmt(r.stdOld)+" / "+fmt(r.stdNew)} sm />
            <TR l="(-) HRA Exempt" v={fmt(r.hraEx)} sm />
            <TR l="(-) LTA + Gratuity + Leave" v={fmt(r.ltaEx+r.grat+r.leaveE)} sm />
            <TR l="Net Salary - Old / New" v={fmt(r.netOld)+" / "+fmt(r.netNew)} bold />
            <TR l="House Property - Old / New" v={fmt(r.hpOld)+" / "+fmt(r.hpNew)} />
            <TR l="Business Income" v={fmt(r.bizInc)} />
            <TR l="Other Income" v={fmt(r.totalOth)} />
            <TR l="GTI - Old / New" v={fmt(r.gtiOld)+" / "+fmt(r.gtiNew)} bold />
          </Card>
          <Card title="Deductions">
            <TR l="80C Investments" v={fmt(r.c80)} />
            <TR l="80CCD(1B) NPS" v={fmt(r.nps)} />
            <TR l="80CCD(2) Employer NPS" v={fmt(r.empNPS)} />
            <TR l="80D Health Insurance" v={fmt(r.dSelf+r.dPar)} />
            <TR l="80G / 80E / 80EE / 80EEA" v={fmt(r.g80+r.e80+r.ee80+r.eea80)} />
            <TR l="80TTA / 80TTB Interest" v={fmt(r.tta)} />
            <TR l="Total Old / New" v={fmt(r.dedOld)+" / "+fmt(r.dedNew)} bold />
          </Card>
          <Card title="Tax Credits">
            <TR l="TDS by Employer" v={fmt(r.tdsEmp)} />
            <TR l="TDS Others" v={fmt(r.tdsOth)} />
            <TR l="Advance Tax" v={fmt(r.advTax)} />
            <TR l="Total Credits" v={fmt(r.paid)} bold />
          </Card>
        </>
      )}

      {tab === "guide" && <FilingGuide r={r} data={data} />}

      <div style={{display:"flex",gap:10,marginTop:14,marginBottom:10}}>
        <button style={{flex:1,background:"#1e293b",color:"#fff",border:"none",borderRadius:11,padding:"12px",fontWeight:700,fontSize:13,cursor:"pointer"}}
          onClick={()=>setModal({type:"copy",title:"Tax Computation Report",filename:"TaxReport.txt",content:buildReport()})}>
          Tax Report
        </button>
        <button style={{flex:1,background:"#1B4FD8",color:"#fff",border:"none",borderRadius:11,padding:"12px",fontWeight:700,fontSize:13,cursor:"pointer"}}
          onClick={()=>setModal({type:"copy",title:"ITR JSON Utility",filename:"ITR_AY2026-27.json",content:buildJSON()})}>
          ITR JSON
        </button>
      </div>
      <div style={{fontSize:11,color:"#991B1B",background:"#FFF7F7",border:"1px solid #FECACA",borderRadius:10,padding:"10px 12px",lineHeight:1.6}}>
        Disclaimer: Reference only. Verify all figures with Form 16, Form 26AS, AIS and a CA before filing. Platform holds no liability for errors or notices.
      </div>
    </Page>
  );
}

function RegCard({ label, regime, taxable, ded, cgTotal, total, paid, payable, refund, isRec }) {
  return (
    <div style={{...S.regCard,...(isRec?S.regCardRec:{})}}>
      {isRec && <div style={S.recBadge}>BEST</div>}
      <div style={{fontWeight:800,fontSize:12,textAlign:"center",marginBottom:8}}>{label}</div>
      <TR l="Deductions" v={fmt(ded)} sm />
      <TR l="Taxable" v={fmt(taxable)} sm />
      <TR l="Base Tax" v={fmt(regime.base)} sm />
      <TR l="(-) Rebate" v={fmt(regime.rebate)} sm />
      <TR l="(+) Surcharge" v={fmt(regime.surcharge)} sm />
      <TR l="(+) Cess 4%" v={fmt(regime.cess)} sm />
      <TR l="(+) CG Tax" v={fmt(cgTotal)} sm />
      <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 4px",fontWeight:800,fontSize:13,borderTop:"2px solid #E2E8F0",marginTop:4}}>
        <span>Total</span><span>{fmt(total)}</span>
      </div>
      <TR l="(-) Credits" v={fmt(paid)} sm />
      {refund>0
        ? <div style={{background:"#F0FDF4",color:"#16a34a",padding:"6px 8px",borderRadius:6,fontSize:12,fontWeight:700,marginTop:6,textAlign:"center"}}>Refund: {fmt(refund)}</div>
        : <div style={{background:"#FEF2F2",color:"#dc2626",padding:"6px 8px",borderRadius:6,fontSize:12,fontWeight:700,marginTop:6,textAlign:"center"}}>{payable>0?"Due: ":"Nil: "}{fmt(payable)}</div>
      }
    </div>
  );
}

function FilingGuide({ r, data }) {
  const reg = r.rec;
  const pay = reg==="old"?r.oldPayable:r.newPayable;
  const ref = reg==="old"?r.oldRefund:r.newRefund;
  const steps = [
    { n:1, t:"Gather Documents", b:"Form 16 (Part A and B) from all employers, Form 16A for FD TDS, Capital Gains Statement from broker/CAMS, health insurance receipts, rent receipts." },
    { n:2, t:"Download Form 26AS and AIS", b:"Login to incometax.gov.in, go to e-File > Income Tax Returns > View Form 26AS and download AIS. Verify TDS of "+fmt(r.paid)+" matches your documents." },
    { n:3, t:"Select ITR Form: "+r.itrForm, b:r.itrForm==="ITR-1"?"ITR-1 (Sahaj): Salaried, one house, no capital gains. Salary up to Rs.50L.":r.itrForm==="ITR-2"?"ITR-2: Capital gains, multiple houses, or salary above Rs.50L. No business income.":"ITR-3: Business or professional income including presumptive 44AD/44ADA." },
    { n:4, t:"Choose "+reg.toUpperCase()+" Regime (saves "+fmt(r.saving)+")", b:(reg==="new"?"New Regime is now the default - no action needed to select it.":"Select Old Regime explicitly on the portal when asked.")+( r.form10IEA?" Also file Form 10-IEA (auto-included in JSON export).":"") },
    { n:5, t:"Login and Start Filing", b:"Visit incometax.gov.in > Login with PAN ("+( data.profile.pan||"your PAN")+") > e-File > Income Tax Returns > File Income Tax Return > AY 2026-27 > Online > "+r.itrForm },
    { n:6, t:"Fill Income Details", b:"Schedule S (Salary): Gross "+fmt(r.gross)+" > Std Deduction. Schedule HP (House Property). Schedule CG (Capital Gains) from broker statement. Schedule OS (Other Sources)." },
    { n:7, t:"Enter Deductions", b:(reg==="old"?"80C: "+fmt(r.c80)+" | 80D: "+fmt(r.dSelf+r.dPar)+" | 80TTA: "+fmt(r.tta):"New Regime - only NPS 80CCD(1B) and Employer NPS")+" | NPS 80CCD(1B): "+fmt(r.nps) },
    { n:8, t:pay>0?"Pay Self-Assessment Tax: "+fmt(pay):"Claim Refund: "+fmt(ref), b:pay>0?"Pay before submitting: e-Pay Tax > Challan 280 > (0021) Income Tax > AY 2026-27 > Self Assessment. Enter challan details in ITR before submitting.":"Refund of "+fmt(ref)+" will be credited to your pre-validated bank account (IFSC: "+(data.profile.ifsc||"-")+") within 20-45 days of e-verification." },
    { n:9, t:"Submit and e-Verify", b:"Deadline: July 31, 2026. e-Verify within 30 days using Aadhaar OTP (fastest), Net Banking, or DSC. ITR is invalid without e-verification." },
  ];
  return (
    <div>
      {steps.map(s=>(
        <div key={s.n} style={{display:"flex",gap:12,marginBottom:10,background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,padding:12}}>
          <div style={{width:26,height:26,minWidth:26,background:"#1B4FD8",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:11}}>{s.n}</div>
          <div>
            <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{s.t}</div>
            <div style={{fontSize:11,color:"#718096",lineHeight:1.6}}>{s.b}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// -- MODALS -------------------------------------------------------------------

function CopyModal({ title, content, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(content).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(fb);
      } else fb();
    } catch { fb(); }
  };
  const fb = () => {
    const t = document.createElement("textarea");
    t.value = content; t.style.cssText="position:fixed;opacity:0";
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch {}
    document.body.removeChild(t);
  };
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px 10px",borderBottom:"1px solid #E2E8F0"}}>
          <div style={{fontWeight:800,fontSize:15}}>{title}</div>
          <button style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#718096"}} onClick={onClose}>x</button>
        </div>
        <div style={{padding:"8px 14px",background:"#F1F5F9",borderBottom:"1px solid #E2E8F0",fontSize:12,color:"#718096"}}>
          Click in the box to select all, then copy. Or use the Copy button.
        </div>
        <textarea style={{flex:1,margin:0,padding:"12px 14px",fontFamily:"monospace",fontSize:11,lineHeight:1.55,color:"#1A202C",background:"#FAFBFC",border:"none",outline:"none",resize:"none",overflowY:"auto",minHeight:240}}
          value={content} readOnly onClick={e=>e.target.select()} />
        <div style={{display:"flex",gap:8,padding:"10px 14px",borderTop:"1px solid #E2E8F0"}}>
          <button style={{flex:2,background:"#1B4FD8",color:"#fff",border:"none",borderRadius:10,padding:"11px 8px",fontWeight:700,fontSize:13,cursor:"pointer"}} onClick={copy}>
            {copied?"Copied!":"Copy to Clipboard"}
          </button>
          <button style={{flex:1,background:"#F1F5F9",color:"#718096",border:"1px solid #E2E8F0",borderRadius:10,padding:"11px 4px",fontWeight:600,fontSize:11,cursor:"pointer"}} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function PasteModal({ title, hint, onClose, onSubmit }) {
  const [text, setText] = useState("");
  const [err, setErr]   = useState("");
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px 10px",borderBottom:"1px solid #E2E8F0"}}>
          <div style={{fontWeight:800,fontSize:15}}>{title}</div>
          <button style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#718096"}} onClick={onClose}>x</button>
        </div>
        <div style={{padding:"10px 14px",background:"#EFF6FF",borderBottom:"1px solid #BFDBFE",fontSize:12,color:"#1D4ED8",lineHeight:1.6}}>{hint}</div>
        <textarea style={{flex:1,margin:0,padding:"12px 14px",fontFamily:"monospace",fontSize:11,lineHeight:1.55,color:"#1A202C",background:"#FAFBFC",border:"none",outline:"none",resize:"none",overflowY:"auto",minHeight:200}}
          placeholder="Paste content here..."
          value={text} onChange={e=>{setText(e.target.value);setErr("");}} autoFocus />
        {err && <div style={{padding:"6px 14px",background:"#FFF7F7",fontSize:12,color:"#dc2626"}}>{err}</div>}
        <div style={{display:"flex",gap:8,padding:"10px 14px",borderTop:"1px solid #E2E8F0"}}>
          <button style={{flex:2,background:text.trim()?"#16A34A":"#94a3b8",color:"#fff",border:"none",borderRadius:10,padding:"11px 8px",fontWeight:700,fontSize:13,cursor:"pointer"}}
            onClick={()=>{ try { onSubmit(text); } catch { setErr("Invalid content - check you copied the complete file"); } }}>
            Import
          </button>
          <button style={{flex:1,background:"#F1F5F9",color:"#718096",border:"1px solid #E2E8F0",borderRadius:10,padding:"11px 4px",fontWeight:600,fontSize:11,cursor:"pointer"}} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// -- PRIMITIVES ---------------------------------------------------------------

function Loading() {
  return (
    <div style={{minHeight:"100vh",background:"#F1F5F9",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
      <div style={{width:36,height:36,background:"#1B4FD8",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18}}>Rs</div>
      <div style={{fontSize:14,color:"#718096"}}>Loading TaxFiler India...</div>
    </div>
  );
}
function Page({ title, children }) {
  return (
    <div style={{padding:"16px 14px 8px"}}>
      <h1 style={{fontSize:21,fontWeight:800,color:"#1A202C",margin:"0 0 16px"}}>{title}</h1>
      {children}
    </div>
  );
}
function Card({ title, onRemove, children }) {
  return (
    <div style={S.card}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <span style={{fontWeight:700,fontSize:13,color:"#1A202C"}}>{title}</span>
        {onRemove && <button style={{background:"#FEF2F2",border:"none",color:"#dc2626",padding:"3px 10px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:700}} onClick={onRemove}>Remove</button>}
      </div>
      {children}
    </div>
  );
}
function FIn({ label, value, onChange, placeholder, type="text", mono, onEnter }) {
  return (
    <div style={{marginBottom:12}}>
      <label style={{display:"block",fontSize:12,fontWeight:600,color:"#718096",marginBottom:4}}>{label}</label>
      <input style={{...S.input,...(mono?{fontFamily:"monospace",fontWeight:600}:{})}}
        type={type} inputMode={type==="number"?"decimal":undefined}
        value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        onKeyDown={e=>onEnter&&e.key==="Enter"&&onEnter()} />
    </div>
  );
}
function Tog({ label, on, onChange }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,cursor:"pointer",userSelect:"none"}} onClick={()=>onChange(!on)}>
      <div style={{width:42,height:22,borderRadius:11,background:on?"#1B4FD8":"#E2E8F0",position:"relative",flexShrink:0,transition:"background 0.2s"}}>
        <div style={{width:16,height:16,background:"#fff",borderRadius:"50%",position:"absolute",top:3,left:on?23:3,transition:"left 0.18s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}} />
      </div>
      <span style={{fontSize:13,color:"#1A202C",lineHeight:1.4}}>{label}</span>
    </div>
  );
}
function Row2({ children }) { return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>{children}</div>; }
function TR({ l, v, bold, sm }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",padding:sm?"4px 0":"6px 0",borderBottom:"1px solid #EDF2F7",fontSize:sm?11:13,fontWeight:bold?700:400,color:bold?"#1A202C":"#2d3748"}}>
      <span>{l}</span><span style={{fontFamily:"monospace",fontWeight:bold?700:600}}>{v}</span>
    </div>
  );
}
function Info({ children }) {
  return <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:10,padding:"10px 13px",fontSize:12,color:"#1D4ED8",lineHeight:1.6,marginBottom:12,marginTop:4}}>{children}</div>;
}
function Warn({ children }) {
  return <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#D97706",marginBottom:8,fontWeight:500}}>{children}</div>;
}

// -- STYLES --------------------------------------------------------------------
const S = {
  app:      { minHeight:"100vh", background:"#F1F5F9", fontFamily:"'Segoe UI',system-ui,sans-serif", paddingBottom:68 },
  header:   { background:"#fff", borderBottom:"1px solid #E2E8F0", padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 },
  hL:       { display:"flex", alignItems:"center", gap:10 },
  hR:       { display:"flex", alignItems:"center", gap:6 },
  menuBtn:  { background:"none", border:"none", cursor:"pointer", padding:"4px 6px", fontSize:13, fontWeight:600, color:"#718096" },
  brand:    { display:"flex", alignItems:"center", gap:8 },
  logo:     { width:32, height:32, background:"#1B4FD8", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:12, flexShrink:0 },
  brandName:{ fontWeight:800, fontSize:14, color:"#1A202C", lineHeight:1.2 },
  brandSub: { fontSize:10, color:"#718096" },
  toast:    { fontSize:12, color:"#16a34a", fontWeight:700 },
  hBtn:     { background:"#EFF6FF", border:"1px solid #BFDBFE", color:"#1B4FD8", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer" },
  avatar:   { width:28, height:28, background:"#1B4FD8", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:12, flexShrink:0 },
  progBg:   { height:3, background:"#E2E8F0" },
  progFill: { height:"100%", background:"#1B4FD8", transition:"width 0.3s" },
  stepTabs: { display:"flex", overflowX:"auto", background:"#fff", borderBottom:"1px solid #E2E8F0", padding:"0 8px" },
  stepTab:  { flexShrink:0, padding:"8px 10px", background:"none", border:"none", borderBottom:"2px solid transparent", fontSize:11, fontWeight:600, color:"#718096", cursor:"pointer", whiteSpace:"nowrap" },
  stepTabOn:{ color:"#1B4FD8", borderBottomColor:"#1B4FD8" },
  liveBanner:{ background:"#1B4FD8", color:"#fff", padding:"6px 14px", display:"flex", flexWrap:"wrap", gap:"4px 16px", fontSize:12 },
  main:     { maxWidth:640, margin:"0 auto" },
  botNav:   { position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #E2E8F0", padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:100 },
  navBtn:   { background:"#1e293b", color:"#fff", border:"none", borderRadius:10, padding:"10px 18px", fontWeight:700, fontSize:14, cursor:"pointer" },
  navLabel: { fontSize:12, fontWeight:600, color:"#718096" },
  card:     { background:"#fff", borderRadius:12, padding:14, marginBottom:12, border:"1px solid #E2E8F0", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" },
  input:    { width:"100%", padding:"10px 12px", border:"1px solid #E2E8F0", borderRadius:10, fontSize:14, color:"#1A202C", background:"#FAFBFC", outline:"none", WebkitAppearance:"none", boxSizing:"border-box" },
  liveBox:  { background:"#EBF0FD", border:"1px solid #BFDBFE", borderRadius:8, padding:"8px 12px", marginBottom:8, fontSize:12, display:"flex", flexWrap:"wrap", gap:"4px 14px", color:"#1e3a8a" },
  addBtn:   { width:"100%", padding:"11px", background:"none", border:"1.5px dashed #1B4FD8", borderRadius:10, color:"#1B4FD8", fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:12 },
  segRow:   { display:"flex", background:"#F1F5F9", borderRadius:9, padding:3, gap:2, marginBottom:12 },
  seg:      { flex:1, padding:"7px 4px", background:"none", border:"none", borderRadius:7, fontSize:11, fontWeight:600, color:"#718096", cursor:"pointer", textAlign:"center" },
  segOn:    { background:"#fff", color:"#1B4FD8", boxShadow:"0 1px 3px rgba(0,0,0,0.1)" },
  pasteArea:{ width:"100%", padding:"10px 12px", border:"1px solid #E2E8F0", borderRadius:10, fontSize:12, color:"#1A202C", background:"#FAFBFC", outline:"none", resize:"vertical", fontFamily:"monospace", lineHeight:1.5, boxSizing:"border-box" },
  btnPri:   { width:"100%", background:"#1B4FD8", color:"#fff", border:"none", borderRadius:12, padding:"13px", fontWeight:800, fontSize:15, cursor:"pointer", marginBottom:4 },
  btnSec:   { width:"100%", background:"none", border:"1.5px dashed #1B4FD8", borderRadius:12, padding:"11px", fontWeight:700, fontSize:14, cursor:"pointer", color:"#1B4FD8", marginBottom:8 },
  linkBtn:  { background:"none", border:"none", color:"#1B4FD8", cursor:"pointer", fontWeight:700, fontSize:13 },
  authBox:  { background:"#fff", border:"1px solid #E2E8F0", borderRadius:12, padding:"18px 14px" },
  errBox:   { background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#dc2626", marginBottom:12, fontWeight:600 },
  tosBox:   { background:"#fff", border:"1px solid #E2E8F0", borderRadius:12, maxHeight:320, overflowY:"auto", padding:14, marginBottom:12 },
  tosCheck: { display:"flex", gap:12, alignItems:"flex-start", background:"#EBF0FD", border:"1px solid #BFDBFE", borderRadius:12, padding:12, marginBottom:12, cursor:"pointer" },
  recBanner:{ borderWidth:1.5, borderStyle:"solid", borderRadius:12, padding:14, marginBottom:12 },
  tabs:     { display:"flex", background:"#fff", borderRadius:10, padding:3, marginBottom:12, border:"1px solid #E2E8F0" },
  tab:      { flex:1, padding:"8px 4px", background:"none", border:"none", borderRadius:8, fontSize:12, fontWeight:600, color:"#718096", cursor:"pointer" },
  tabOn:    { background:"#1B4FD8", color:"#fff" },
  regCard:  { background:"#fff", border:"1px solid #E2E8F0", borderRadius:12, padding:"14px 10px", position:"relative", paddingTop:18 },
  regCardRec:{ border:"2px solid #1B4FD8", background:"#EBF0FD" },
  recBadge: { position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", background:"#1B4FD8", color:"#fff", fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20, whiteSpace:"nowrap" },
  overlay:  { position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" },
  modalBox: { background:"#fff", borderRadius:"16px 16px 0 0", width:"100%", maxWidth:640, maxHeight:"88vh", display:"flex", flexDirection:"column", overflow:"hidden" },
};

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; }
  input, button, select, textarea { font-family: inherit; }
  input[type=number] { -moz-appearance: textfield; }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input:focus, textarea:focus { border-color: #1B4FD8 !important; box-shadow: 0 0 0 3px rgba(27,79,216,0.14); outline: none; }
  button:active { opacity: 0.82; }
  .stepTabs::-webkit-scrollbar { height: 0; }
`;
