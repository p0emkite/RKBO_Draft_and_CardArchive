-- RKBO ONLINE v1 · Supabase SQL Editor setup.
-- Read-only leaderboard for public visitors; only Edge Function may insert results.
create extension if not exists pgcrypto;
create table if not exists public.rkbo_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null unique check (char_length(nickname) between 2 and 20),
 created_at timestamptz not null default now()
);
create table if not exists public.rkbo_draft_results (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.rkbo_profiles(user_id) on delete cascade,
 mode text not null check (mode in ('season','all')),
 hidden boolean not null default false,
 season integer not null check (season between 1 and 999),
 average_ovr numeric(4,1) not null check (average_ovr between 0 and 99),
 tpi integer not null check (tpi between 0 and 1000),
 picks jsonb not null check (jsonb_typeof(picks)='array' and jsonb_array_length(picks)=18),
 lineup jsonb, -- server-validated batting order, fielding spots, rotation and bullpen
 created_at timestamptz not null default now()
);
-- Safe when upgrading an existing RKBO database created before lineup support.
alter table public.rkbo_draft_results add column if not exists lineup jsonb;
create index if not exists rkbo_draft_rank_idx on public.rkbo_draft_results(mode,hidden,season,tpi desc,average_ovr desc,created_at asc);
create index if not exists rkbo_draft_user_idx on public.rkbo_draft_results(user_id,created_at desc);
alter table public.rkbo_profiles enable row level security;
alter table public.rkbo_draft_results enable row level security;
revoke all on public.rkbo_profiles from anon,authenticated;
revoke all on public.rkbo_draft_results from anon,authenticated;
grant select on public.rkbo_profiles to anon,authenticated;
grant insert(user_id,nickname),update(nickname) on public.rkbo_profiles to authenticated;
grant select on public.rkbo_draft_results to anon,authenticated;
drop policy if exists rkbo_profiles_public on public.rkbo_profiles;
drop policy if exists rkbo_profiles_own_insert on public.rkbo_profiles;
drop policy if exists rkbo_profiles_own_update on public.rkbo_profiles;
drop policy if exists rkbo_results_public on public.rkbo_draft_results;
create policy rkbo_profiles_public on public.rkbo_profiles for select to anon,authenticated using (true);
create policy rkbo_profiles_own_insert on public.rkbo_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy rkbo_profiles_own_update on public.rkbo_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy rkbo_results_public on public.rkbo_draft_results for select to anon,authenticated using (true);
comment on table public.rkbo_draft_results is 'Server-validates card identities, OVRs and team scores. Random-offer fairness cannot yet be proven (v1 beta).';


-- MY RKBO: private, account-owned editable team snapshots (not public rankings).
create table if not exists public.rkbo_saved_teams (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 2 and 40),
 mode text not null check (mode in ('season','all')),
 hidden boolean not null default false,
 season integer not null check (season between 1 and 999),
 average_ovr numeric(4,1) not null check (average_ovr between 0 and 99),
 tpi integer not null check (tpi between 0 and 1000),
 slots jsonb not null check (jsonb_typeof(slots)='array' and jsonb_array_length(slots)=18),
 lineup jsonb not null check (jsonb_typeof(lineup)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists rkbo_saved_teams_owner_idx on public.rkbo_saved_teams(user_id,updated_at desc);
alter table public.rkbo_saved_teams enable row level security;
revoke all on public.rkbo_saved_teams from public,anon,authenticated;
grant select,insert,update,delete on public.rkbo_saved_teams to authenticated;
drop policy if exists rkbo_saved_teams_own_select on public.rkbo_saved_teams;
drop policy if exists rkbo_saved_teams_own_insert on public.rkbo_saved_teams;
drop policy if exists rkbo_saved_teams_own_update on public.rkbo_saved_teams;
drop policy if exists rkbo_saved_teams_own_delete on public.rkbo_saved_teams;
create policy rkbo_saved_teams_own_select on public.rkbo_saved_teams for select to authenticated using ((select auth.uid())=user_id);
create policy rkbo_saved_teams_own_insert on public.rkbo_saved_teams for insert to authenticated with check ((select auth.uid())=user_id);
create policy rkbo_saved_teams_own_update on public.rkbo_saved_teams for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy rkbo_saved_teams_own_delete on public.rkbo_saved_teams for delete to authenticated using ((select auth.uid())=user_id);
