# StudyHub

## Status
This is the Vite + React project scaffold around the StudyHub app. It will
build and deploy, but two things still rely on the Claude artifact
environment and need to be replaced before the app is fully functional
outside of Claude:

1. **`window.storage` calls** (in `src/App.jsx`) — currently used to save
   student progress, streaks, and app data. Needs to be swapped for a real
   database (e.g. Supabase, Firebase, or a small backend + Postgres).
2. **Direct `fetch` to `api.anthropic.com`** (in `src/App.jsx`, around the
   AI chat/practice-test features) — this has no API key attached because
   Claude's artifact environment injects it automatically. On a real
   deployment this call must go through your own backend server that holds
   your Anthropic API key privately (never put an API key in frontend code).

## Local development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```
