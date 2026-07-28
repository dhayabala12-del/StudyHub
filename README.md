# StudyHub

## Status
This is the Vite + React project scaffold around the StudyHub app.

Done:
- **Database + login**: swapped `window.storage` for Supabase (`kv_store`
  table with row-level security). Login now uses real Supabase email
  magic-link auth instead of a client-side email format check. Run
  `supabase_setup.sql` once in your Supabase project's SQL Editor before
  first use, and set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as
  environment variables (locally in `.env.local`, and in Vercel's project
  settings).

Still needed:
- **Direct `fetch` to `api.anthropic.com`** (in `src/App.jsx`, around the
  AI chat/practice-test features) — this has no API key attached because
  Claude's artifact environment injects it automatically. On a real
  deployment this call must go through your own backend server (e.g. a
  Vercel serverless function) that holds your Anthropic API key privately
  (never put an API key in frontend code).

## Local development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```
