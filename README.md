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
- **AI features**: `api/chat.js` is a Vercel serverless function that
  proxies requests to Claude using `ANTHROPIC_API_KEY` (set as a Vercel
  environment variable, never in frontend code). The frontend now calls
  `/api/chat` instead of `api.anthropic.com` directly.

## Local development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```
