# RKBO ONLINE v1 — Setup instructions

GitHub Pages hosts the frontend. Supabase handles email login, profiles and public rankings.

## Setup steps for the project owner

1. Create a project at https://supabase.com/dashboard .
2. In SQL Editor, run the content of supabase/schema.sql.
3. In Authentication > URL Configuration, use Site URL and Redirect URL:
   https://p0emkite.github.io/RKBO_Draft_and_CardArchive/
4. Enable Email (OTP or magic-link) sign-in. Production email volume may require SMTP setup.
5. Deploy the Supabase Edge Function from this repo:
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy draft-submit --no-verify-jwt
6. In rkbo-online-config.js set enabled to true and add the Project URL and PUBLIC publishable/anon key, not a secret key.

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
