# RKBO ONLINE v1 — Setup instructions

GitHub Pages hosts the frontend. Supabase handles **Google and Kakao OAuth login**, profiles and public rankings.

## Setup steps for the project owner

1. Create a project at https://supabase.com/dashboard .
2. In SQL Editor, run the content of supabase/schema.sql.
3. In Authentication > URL Configuration, use Site URL and Redirect URL:
   https://p0emkite.github.io/RKBO_Draft_and_CardArchive/
4. Configure **Google sign-in** (no email OTP/magic-link setup required):
   - In Supabase Authentication > URL Configuration, set both Site URL and an allowed Redirect URL to `https://p0emkite.github.io/RKBO_Draft_and_CardArchive/`.
   - In Supabase Authentication > Sign In / Providers > Google, enable Google and copy the **Callback URL** (it looks like `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`).
   - Go to [Google Auth Platform](https://console.cloud.google.com/auth/overview). Create/select a Google Cloud project, configure OAuth consent/branding and an External audience, then create an **OAuth client ID** of type Web application.
   - Authorized JavaScript origin: `https://p0emkite.github.io` (no repository path).
   - Authorized redirect URI: **the Supabase Google provider callback URL**, not the GitHub Pages URL.
   - Enter Google's **Client ID** and **Client Secret** into the Supabase Google provider settings and save. Do **not** put the Google Client Secret in this repository, frontend config, or chat.
   - While Google's OAuth app is in Testing mode, add intended test Google accounts to Test users. For unrestricted public sign-in, publish the OAuth app as appropriate.
   - The RKBO browser uses `signInWithOAuth({provider:"google"})`; it does not send sign-in emails.
4a. Configure **Kakao sign-in** alongside Google:
   - Open [Kakao Developers](https://developers.kakao.com/) > App > Create app and create your RKBO app.
   - In App Settings > App > Platform Key, find the **REST API key** (Kakao OAuth Client ID).
   - Click that REST API key and register the Supabase Kakao **Callback URL** from Authentication > Sign In / Providers > Kakao as the Kakao Login Redirect URI. The provider callback is `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`, **not** your GitHub Pages URL.
   - Activate the Kakao Login Client Secret code (Kakao OAuth Client Secret), and turn Kakao Login on under Product Settings > Kakao Login > General.
   - Set necessary consent items under Product Settings > Kakao Login > Consent Items. An email is optional; if unavailable, enable **Allow users without an email** in Supabase's Kakao provider.
   - In Supabase Authentication > Sign In / Providers > Kakao, enable Kakao and enter the **REST API key** and **Kakao Login Client Secret**. Do not place secrets in GitHub or share them in chat.
   - The browser calls `signInWithOAuth({provider:"kakao"})`. Google OAuth remains available in parallel.
   - Accounts from separate identity providers are not automatically guaranteed to share one RKBO user profile; test each provider separately. Future account linking may be implemented.

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

Each player may play without login and store scores locally. **Google or Kakao login** is needed to publish a score globally.

## Security

Supabase RLS gives public visitors read-only scoreboard access. Only the server-side Edge Function may insert game results; it verifies the 18 official card identities, legal slot positions, OVR and computed TPI. A per-user hourly limit is enforced.

Limitation: in v1 the browser shuffles random offers; the server does not know which exact three cards were presented on each round. This is a casual beta board, not a tamper-proof prize competition. Server-issued draft sessions are the next step for robust competitive integrity.
