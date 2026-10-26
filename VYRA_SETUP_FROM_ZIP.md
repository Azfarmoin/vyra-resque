# VYRA: setup from unzip to deploy (Supabase + Gemini or OpenAI)

Database: **Supabase** (PostgreSQL). This project does not run on MongoDB Atlas; see "Why not MongoDB Atlas" at the end.
AI: **Gemini** or **OpenAI (ChatGPT API)**, chosen with environment variables.

## 0. Tools
- Node.js 20 (`.nvmrc`): check with `node -v`
- Git, and free accounts on Supabase, GitHub, Vercel, and Google AI Studio or OpenAI

## 1. Unzip and install
```bash
unzip VYRA-unified.zip
cd VYRA-unified
npm install
cp .env.example .env.local      # Windows PowerShell: copy .env.example .env.local
```

## 2. Try it with no setup (optional, 1 minute)
```bash
npm run dev:demo
```
Open http://localhost:3000. Data is in memory; nothing is saved. Stop it with Ctrl+C.

## 3. Create the Supabase project
1. supabase.com > New project. Choose a region near Karachi (Singapore or Mumbai) and set a database password. Save it.
2. Project Settings > API Keys: copy **Project URL**, **Publishable key**, and the **secret / service_role** key.
3. Click **Connect** > **Session pooler** and copy the connection string.

## 4. Fill `.env.local`
```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=...            # server only; needed for photo viewing and instant accounts
DATABASE_URL=postgresql://postgres.YOUR-REF:YOUR-PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
SEED_PASSWORD=pick-a-long-password       # password for all demo accounts

# AI: pick one
AI_PROVIDER=gemini
GEMINI_API_KEY=...
# or:  AI_PROVIDER=openai  and  OPENAI_API_KEY=...
VYRA_SIGNING_SECRET=any-long-random-string
CRON_SECRET=another-long-random-string   # 16+ characters
```
Special characters in the database password must be URL-encoded (`@` becomes `%40`).
Restart `npm run dev` after any edit to this file.

## 5. Create tables and load demo data
```bash
npm run db:setup -- --seed
```
It runs all 18 SQL files and loads the demo data. It prints a row count per table.
Use `--small` for the 30-rows-per-table seed: `npm run db:setup -- --seed --small`.
If you prefer the dashboard, paste the SQL files into the SQL Editor in the order listed in `SETUP_GUIDE.md` Step 4.

## 6. Supabase sign-in settings
Authentication > Sign In / Providers > Email: turn **Confirm email** off for a demo (leave it on for a real launch).

## 7. Run locally
```bash
npm run dev
```
Sign in at /auth/login as `admin@demo.vyra` with your `SEED_PASSWORD`.
Check: `curl http://localhost:3000/api/demo/auth` prints `{"demo":false}`.
Test the AI: /report > attach a photo of flooding > the photo analysis panel should return a result.

## 8. Make your own account an admin
Register normally, then in Supabase SQL Editor:
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'you@example.com';
```
Sign out and in again.

## 9. Checks before deploying
```bash
npx tsc --noEmit
npm test
npm run build
```

## 10. Deploy to Vercel
1. Create a GitHub repo and push (`.env.local` is git-ignored):
   ```bash
   git init && git add . && git commit -m "VYRA" && git branch -M main
   git remote add origin https://github.com/YOU/vyra.git && git push -u origin main
   ```
2. vercel.com > Add New > Project > import the repo (Next.js is detected).
3. Settings > Environment Variables. Add: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER`, `GEMINI_API_KEY` (or `OPENAI_API_KEY`), `VYRA_SIGNING_SECRET`, `CRON_SECRET`.
   Do NOT add `DATABASE_URL` or `SEED_PASSWORD`. Never prefix secret keys with `NEXT_PUBLIC_`.
4. Deploy. Then in Supabase > Authentication > URL Configuration set **Site URL** to your Vercel address and add it to Redirect URLs.
5. Visit `https://YOUR-APP.vercel.app/api/demo/auth`: expect `{"demo":false}`.

Optional: early-warning alerts need a scheduler calling `POST /api/alerts/cron` with `Authorization: Bearer <CRON_SECRET>`, plus the `ALERT_*` and VAPID variables from `.env.example` (`npm run vapid:generate`).

## Before sharing the link
Seeded accounts are demo accounts; set `SEED_PASSWORD` before seeding, and read the "Before anyone else can reach it" section of `SETUP_GUIDE.md`.

## Troubleshooting
| Problem | Fix |
|---|---|
| `DATABASE_URL is missing` / auth failed | Use the Session pooler string, URL-encode the password. |
| Sign-in shows "Demo accounts" | `NEXT_PUBLIC_SUPABASE_URL` is empty or `VYRA_DATA_MODE=demo`. |
| Photo analysis says "not set up" | Missing key, or `AI_PROVIDER` names a provider whose key is not set. Restart the server. |
| Photo analysis "HTTP 404/400" | Model name not valid for your key. Set `VYRA_AI_MODEL` to a current vision-capable model. |
| Photos not visible to responders | `SUPABASE_SERVICE_ROLE_KEY` missing. |
| Pages empty | Seed did not run; check row counts printed by `db:setup`. |

## Why not MongoDB Atlas
The app uses Supabase for the database, sign-in, file storage and row-level security (18 SQL migrations, about 45 source files). Moving to MongoDB means rewriting the data layer, accounts and photo storage, and re-implementing the security rules in code. It is a separate project, not a configuration change.
