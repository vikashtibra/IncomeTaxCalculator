# How To: Set Up, Run, and Deploy TaxFiler India

## 1. Local development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## 2. Supabase setup

The app needs a free [Supabase](https://supabase.com) project for accounts and storage.

1. Create a project at supabase.com.
2. In the **SQL Editor**, run:

```sql
create table tax_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table tax_data enable row level security;
create policy "own row" on tax_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salt text not null, wrapped_dk text not null, iv text not null
);
alter table user_keys enable row level security;
create policy "own row" on user_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

3. Go to **Settings → API** and copy the **Project URL** and **anon/public key**.
4. Go to **Authentication → URL Configuration** and set **Site URL** (and add to **Redirect URLs**) to wherever the app is hosted — `http://localhost:5173` for local dev, or your production URL (e.g. `https://your-app.vercel.app`). This controls where confirmation/password-reset emails link back to.

## 3. Environment variables

Create `.env.local` in the project root (already covered by `.gitignore`, never committed):

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Restart `npm run dev` after creating/changing this file — Vite only reads env vars at server start.

> The anon key is safe to expose in the frontend bundle — access control is enforced by the Row Level Security policies above, not by hiding the key. Never use the `service_role`/`secret` key in frontend code.

## 4. Deploying to Vercel

1. Push the repo to GitHub.
2. In Vercel: **New Project** → import the repo. Framework preset auto-detects Vite (`npm run build`, output `dist`).
3. Before/after the first deploy, add the same two env vars under **Project Settings → Environment Variables**.
4. Deploy. Any push to `main` auto-redeploys.
5. Update the Supabase **Site URL** / **Redirect URLs** to include your `*.vercel.app` (or custom) domain — otherwise confirmation/reset emails will link to the wrong place.

If you change env vars after the first deploy, trigger a **Redeploy** — they're baked in at build time, not read at runtime.

## 5. Using the app

1. **Terms of Service** → accept.
2. **Register/Login** — email + password via Supabase Auth.
3. **Profile** → fill personal/bank details. Choose **Data Storage** mode:
   - **Cloud**: encrypted with your password, syncs across devices/browsers. On a new browser/tab you'll be asked to re-enter your password once to unlock.
   - **Local**: stays only in this browser, no account sync.
4. **Salary** → add employer(s). Click **Upload Form 16 (PDF)** to auto-fill Gross Salary, HRA, TDS, and 80C from a real Form 16 — review the extracted values before applying (PDF layouts vary, always double-check).
5. Fill **Property / Capital Gains / Business / Other Income / Deductions / TDS** as applicable.
6. **Results** → see the Old vs New regime comparison, breakdown, and step-by-step filing guide. Export a **Tax Report** (plain text) or **ITR JSON** (reference payload) via copy-to-clipboard.
7. Click **Save** anytime, or rely on autosave (triggers on Next / step-tab navigation / logout).
8. **Backup**/**Restore** (Profile or header) — a manual JSON snapshot for your own records, independent of cloud sync. Restoring requires being logged in first.

## 6. Changing/resetting your password (Cloud mode)

- **Change Password** (Profile, while logged in): sets a new password and automatically re-secures your encryption key — no data lost.
- **Forgot Password** (login screen): sends a reset email. If completed in the same browser where you were last logged in, your data is preserved automatically. From a different/cleared browser, old encrypted Cloud data can't be recovered (by design — there's no backend escrow), but the account keeps working for new data going forward.

## 7. Running tests / checks

```bash
npm run lint
npm run build
```

There is no automated test suite. Verify changes by running the app (`npm run dev`) and exercising the affected flow in a browser.
