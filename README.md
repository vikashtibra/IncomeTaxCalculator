# TaxFiler India

A browser-based Indian income tax calculator and filing assistant for **FY 2025-26 / AY 2026-27**. Compares the Old and New tax regimes side by side, tracks salary/capital gains/business/other income, suggests deductions, and generates a plain-text tax report and a reference ITR JSON payload.

Built with React + Vite, [Supabase](https://supabase.com) for accounts and storage.

## Features

- Old vs New regime comparison with live recommendation
- Multi-employer salary entry with **Form 16 PDF upload** to auto-fill fields
- House property, capital gains (equity/debt/other), business (presumptive 44AD/44ADA), and other income sections
- Deductions: 80C, NPS (80CCD 1B/2), 80D, 80G, 80E/80EE/80EEA, 80TTA/80TTB, HRA exemption
- TDS/advance tax tracking, §234B interest estimate, ITR form (1/2/3) suggestion
- **Two storage modes** (Profile settings):
  - **Cloud** — synced to your account, client-side AES-GCM encrypted with a key derived from your password before it ever leaves the browser
  - **Local** — stays only in this browser, never sent to any server
- Account login (Supabase Auth), change password / forgot password (re-encrypts your data automatically when changing/resetting)
- Manual JSON backup/restore for your own records

## Tech stack

- React 19 + Vite
- [Supabase](https://supabase.com) — Auth + Postgres (`tax_data`, `user_keys` tables, RLS-protected)
- [pdfjs-dist](https://github.com/mozilla/pdf.js) — client-side Form 16 PDF text extraction
- Web Crypto API — AES-GCM encryption, PBKDF2 key derivation (no crypto library dependency)

## Getting started

See [HOWTO.md](HOWTO.md) for full setup (Supabase project, env vars, local dev, deployment).

```bash
npm install
npm run dev      # starts Vite dev server
npm run build    # production build
npm run lint
```

## Documentation

- [HLD.md](HLD.md) — architecture, data model, key flows (encryption, save/load, password recovery, Form 16 parsing), security model
- [HOWTO.md](HOWTO.md) — setup, Supabase configuration, deployment to Vercel
- [ITR_RULES_COVERED.md](ITR_RULES_COVERED.md) — exact tax rules, slabs, and limits implemented in the calculator

## Disclaimer

This is a **reference tool only** — it does not constitute professional tax or legal advice. It covers **Resident Individuals only** (excludes NRIs, HUFs, foreign income, Crypto/VDA, companies, LLPs). Always verify results with a qualified Chartered Accountant and the official utility at [incometax.gov.in](https://incometax.gov.in) before filing.
