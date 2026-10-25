# RKBO ONLINE v1 — Setup instructions

GitHub Pages hosts the frontend. Supabase handles email login, profiles and public rankings.

## Setup steps for the project owner

1. Create a project at https://supabase.com/dashboard .
2. In SQL Editor, run the content of supabase/schema.sql.
3. In Authentication > URL Configuration, use Site URL and Redirect URL:
   https://p0emkite.github.io/RKBO_Draft_and_CardArchive/
4. Enable Email (OTP or magic-link) sign-in. Production email volume may require SMTP setup.
5. Deploy the `draft-submit` Edge Function. Supabase Dashboard option (no terminal required):
   - Open Edge Functions > Deploy a new function > Via Editor.
   - Name the function `draft-submit` and replace the editor content with `supabase/functions/draft-submit/index.ts`.
   - Deploy the function, then open its Details/Settings and disable the legacy JWT verification toggle (`verify_jwt = false`). **The function still verifies the signed-in user token itself via auth.getUser.**
   - The Edge runtime injects `SUPABASE_SECRET_KEYS` automatically; **do not paste a secret into the editor or GitHub**.
   
   Or deploy via Supabase CLI from the repository root (Node.js 20+):
   npm install supabase --save-dev
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy draft-submit --no-verify-jwt
   Alternatively, if Supabase is connected to ChatGPT, the assistant can guide/manage your project's SQL and function deployment with your approval.
6. In `rkbo-online-config.js` set `enabled` to true and add the Project URL and PUBLIC `sb_publishable_...` key from Settings > API Keys, not any secret key.
7. Verify RLS for `rkbo_profiles` and `rkbo_draft_results` is enabled in Database > Tables. The schema explicitly enables RLS and restricts public access to SELECT. Test permissions with both signed-out and signed-in sessions.

### About automatic RLS
Keep **Enable automatic RLS** enabled when available. Our `schema.sql` also explicitly enables RLS on both tables, so the SQL safeguards apply even if the project option was not selected. Never disable RLS on either RKBO table.

### Important for new projects
The Edge Function reads the server-only `SUPABASE_SECRET_KEYS` environment variable (and has legacy `SUPABASE_SERVICE_ROLE_KEY` fallback for older projects). The secret key is injected by Supabase at runtime; it is never added to GitHub. For browser access, use only the public `sb_publishable_...` key.

These config fields are safe for browsers:
  window.RKBOOnlineConfig={enabled:true,url:"https://YOUR_PROJECT_REF.supabase.co",publishableKey:"YOUR_PUBLIC_KEY"};

Do not share SUPABASE_SERVICE_ROLE_KEY or any private API key.

## Four boards

- Current season: filters by selected season
- All-time
- Current season (hide OVR and grade during draft)
- All-time (hide OVR and grade during draft)

Each player may play without login and store scores locally. Login is needed to publish a score globally.

## Security

Supabase RLS gives public visitors read-only scoreboard access. Only the server-side Edge Function may insert game results; it verifies the 18 official card identities, legal slot positions, OVR and computed TPI. A per-user hourly limit is enforced.

Limitation: in v1 the browser shuffles random offers; the server does not know which exact three cards were presented on each round. This is a casual beta board, not a tamper-proof prize competition. Server-issued draft sessions are the next step for robust competitive integrity.
