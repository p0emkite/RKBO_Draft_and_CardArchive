# RKBO ONLINE v1 — Setup instructions

GitHub Pages hosts the frontend. Supabase handles **Google OAuth login**, profiles and public rankings.

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
   - Google Cloud > Google Auth Platform > Branding lets you set the app name (e.g. `RKBO DRAFT`); a verified and published brand is required before Google displays your custom name instead of the authorization domain.
   - The Google account chooser may continue to show the Supabase `*.supabase.co` hostname until a custom Supabase Auth domain is configured. Changing only the Google app name does not change this hostname.
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

## Draft lineup editing (October 2026)
- Blind mode masks **OVR, card tier, and all five player ratings** until the result screen. Stat values appear as `??` with black font on a pale background.
- Draft selection text says **선발** / **중계** without a numbered position. Slot IDs remain `SP1...SP5` / `RP1...RP3` for verification.
- After picking 18 players, use **라인업 편집하기**. Drag a row onto another on desktop, or tap two different players in the same group on mobile.
- Editable groups: batting order (9), defensive assignments including DH (9), starting rotation (5), and middle reliever order (3). The closer remains fixed.
- TPI is calculated from the exact drafted 18 cards, not their lineup ordering.
- `rkbo_draft_results.lineup` stores server-validated assignments as JSONB. Older results keep `NULL` and render with the original slot order. Client-submitted lineups must be permutations of the drafted slots; original card/OVR/server verification stays in force.
- Online roster details use the same Korean-name mapping used by the card archive, with English as a fallback for unmatched historical cards.

## Four boards

- Current season: filters by selected season
- All-time
- Current season (hide OVR and grade during draft)
- All-time (hide OVR and grade during draft)

Each player may play without login and store scores locally. **Google login** is needed to publish a score globally.

## Security

Supabase RLS gives public visitors read-only scoreboard access. Only the server-side Edge Function may insert game results; it verifies the 18 official card identities, legal slot positions, OVR and computed TPI. A per-user hourly limit is enforced.

Limitation: in v1 the browser shuffles random offers; the server does not know which exact three cards were presented on each round. This is a casual beta board, not a tamper-proof prize competition. Server-issued draft sessions are the next step for robust competitive integrity.

## MY RKBO private saved teams
- Supabase migration adds `public.rkbo_saved_teams` with owner-only SELECT, INSERT, UPDATE and DELETE RLS policies. Anonymous visitors have no access to this table.
- Teams are saved privately, separately from competitive `rkbo_draft_results`. Saving a team never adds a public ranking entry.
- On the draft result screen, use **💾 내 팀에 저장** (team name 2–40 characters). A loaded team can be overwritten or saved as a copy.
- Use the **💾 MY RKBO** button in the site navigation to list teams, inspect names, restore an 18-player lineup, rename a team or delete it.
- Restoring looks up the official card IDs from local season assets and re-applies the Korean name map. Saved lineup permutations are checked again before display.
- Defense positions are constrained to the player's original card position (or DH) by both UI logic and the `draft-submit` Edge Function. TPI is unaffected by batting/pitching-order edits.
- The saved-team API is operated through the authenticated browser Supabase client under RLS. Never include service-role or secret credentials in the browser.
- Edge Function `draft-submit` remains the sole path for posting *public* leaderboard results, with server-side OVR and native-position validation.


## Card packs & personal collection (60th season v1, 2026-10-26)
- Exactly **5 independent draws per pack**. Tier-level rates: Bronze **45%**, Silver **30%**, Gold **15%**, Coral **7%**, Diamond **3%**. Pack names use the existing **Coral** grading (no Platinum alias). No guaranteed Bronze card.
- **50-pack Diamond pity**: following 49 packs with no Diamond, the 5th card of pack 50 is guaranteed Diamond. A pack containing a Diamond resets the streak. Pity overrides the base draw rate only where active. These are per-account counts.
- Initially available pack contents are **60th-season cards only**, all **181** season 60 cards including 43 Bronze cards. The previous 59th-season inventory, if any, is preserved in the DB but 59th-season pack opening is disabled.
- `supabase/card-pack-system.sql` creates the catalog, account-owned inventory and pack state, open history, and transactional `public.rkbo_open_card_pack(60)` RPC. Random tier selection and inventory writes only occur server-side; never accept user-submitted card ID or grade.
- `rkbo_pack_cards` is publicly readable, not client-writable. `rkbo_card_inventory`, `rkbo_pack_state`, `rkbo_pack_history` are owner-readable under RLS but not client-writable. `rkbo_open_card_pack` EXECUTE is granted only to authenticated. It validates `auth.uid()` and `auth.jwt()->>'role'` (not legacy `request.jwt.claim.role`) plus non-anonymous status.
- On GitHub Pages `rkbo-card-packs.js` uses the same Supabase client and login session as `rkbo-online.js`. **Each browser/device needs its own login**. A missing session brings up a direct Google login button.
- `rkbo-archive-collection.js` adds collection percentage for the selected season and each team, using official player IDs and authenticated inventory counts. Logged-in users see a 50%-black visual overlay on unowned cards in the main archive; owned cards render unobstructed. When signed out, the public archive remains unobstructed.
- After successful pack opening the collection refreshes via `rkbo-pack-opened`. When the season changes, the progress widgets recalculate for that season. At present only season 60 cards can be newly acquired.
- Free-to-play prototype. No payment, trading, transfers or real-money rewards. The public overall card archive and draft game are unaffected.


## Pack reveal, creator controls and duplicate-card cosmetics (October 2026)
- High-tier Coral/Diamond intro now presents the team logo, position and tier in individually paced steps (~1.3–1.6 seconds each), then reveals a card-back → card-front 3D flip (~1.55s). Pulse/glow effects surround the card without overwriting its original rarity frame. Reduced-motion settings are respected in CSS.
- Card-pack availability is stored server-side in \`rkbo_pack_settings\`. Only activated seasons are offered to players; \`rkbo_open_card_pack(p_season)\` validates against that table, preserving the same 45/30/15/7/3 drop odds and global 50-pack Diamond guarantee.
- The creator enters the site's \`?admin=1\` URL and logs into their **pre-authorized Google/Supabase account**. Query parameter alone cannot authorize changes. A separate \`rkbo_pack_admins\` table lists eligible account UUIDs. Admin controls include choosing a season, setting pack name, enabling/disabling the pack, and uploading pack artwork (PNG/JPEG/WebP, max 3 MB). A public Supabase Storage bucket serves the artwork; only verified administrators can write. Removing a pack **deactivates** it rather than deleting historical records or cards.
- On activation the creator submits official archive card metadata for that season to the privileged \`rkbo_manage_pack\` RPC. The server rejects activation unless **all five tiers** exist in that season's catalog. This supports adding more seasons over time without allowing ordinary visitors to forge cards or configure packs.
- The \`rkbo_upgrade_card(p_card_id,p_kind)\` RPC atomically consumes **5 copies for a gold extra frame** or **10 copies for a permanent prism film**. Both are independent one-time per-card upgrades. Serial row locking plus a unique upgrade ledger prevent double spending.
- When remaining quantity reaches zero after an upgrade, the inventory row and cosmetic entitlement remain and the player stays unlocked in both the private collection and main archive. Gold/prism effects appear in the card grid and detail modal.
- Run \`supabase/pack-admin-upgrades.sql\` after the basic pack system to set up the creator registry, pack list, secured image bucket, cosmetic columns and upgrade RPC. The administrator bootstrap targets the user's already verified existing Supabase auth account; never put admin UUIDs, secrets, or service role credentials into GitHub browser files.
- Before considering this release fully verified, manually open a Coral/Diamond card, upload a pack image as a creator, activate a new season, and test upgrade spend against actual duplicate cards. JavaScript syntax and SQL rights checks do not substitute for end-to-end browser testing.
