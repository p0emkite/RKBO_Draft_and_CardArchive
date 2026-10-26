-- MATCH 2.0: per-season CPU ladder (official card data stays in GitHub).
-- The Edge Function alone commits outcomes. Browser accounts may only read their own progress.
create table if not exists public.rkbo_ladder_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 season integer not null check(season between 1 and 60),
 cleared_count integer not null default 0 check(cleared_count between 0 and 10),
 updated_at timestamptz not null default now(),
 primary key(user_id,season)
);
create table if not exists public.rkbo_ladder_matches (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 team_id uuid references public.rkbo_owned_teams(id) on delete set null,
 team_name text not null,
 season integer not null check(season between 1 and 60),
 opponent_code text not null,
 opponent_rank integer not null check(opponent_rank between 1 and 10),
 our_runs integer not null check(our_runs between 0 and 999),
 cpu_runs integer not null check(cpu_runs between 0 and 999),
 result text not null check(result in ('WIN','LOSS','DRAW')),
 innings jsonb not null,
 events jsonb not null,
 player_stats jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists rkbo_ladder_matches_user_recent on public.rkbo_ladder_matches(user_id,created_at desc);
create index if not exists rkbo_ladder_matches_user_season on public.rkbo_ladder_matches(user_id,season,created_at desc);
alter table public.rkbo_ladder_progress enable row level security;
alter table public.rkbo_ladder_matches enable row level security;
revoke all on table public.rkbo_ladder_progress,public.rkbo_ladder_matches from anon,authenticated;
grant select on table public.rkbo_ladder_progress,public.rkbo_ladder_matches to authenticated;
create policy rkbo_ladder_progress_owner_read on public.rkbo_ladder_progress
 for select to authenticated using ((select auth.uid())=user_id);
create policy rkbo_ladder_matches_owner_read on public.rkbo_ladder_matches
 for select to authenticated using ((select auth.uid())=user_id);
create or replace function public.rkbo_commit_ladder_match(
 p_user uuid,p_team uuid,p_season integer,p_opponent text,p_rank integer,p_total integer,
 p_our_runs integer,p_cpu_runs integer,p_innings jsonb,p_events jsonb,p_stats jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_team public.rkbo_owned_teams%rowtype;
 v_cleared integer;
 v_id uuid;
 v_result text;
 v_new integer;
begin
 -- EXECUTE is granted solely to service_role; the Edge Function validates auth.getUser().
 if p_user is null or p_team is null or p_season not between 1 and 60
    or p_total not between 2 and 10 or p_rank not between 1 and p_total
    or p_our_runs not between 0 and 999 or p_cpu_runs not between 0 and 999
    or jsonb_typeof(p_innings)<>'array' or jsonb_array_length(p_innings)<>9
    or jsonb_typeof(p_events)<>'array' or jsonb_typeof(p_stats)<>'object'
    or length(coalesce(p_opponent,'')) not between 2 and 8
 then raise exception 'Invalid ladder match' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':'||p_season::text,0));
 select * into v_team from public.rkbo_owned_teams where id=p_team and user_id=p_user;
 if not found then raise exception 'Save a MY TEAM before playing' using errcode='22023'; end if;
 if exists(select 1 from public.rkbo_ladder_matches
           where user_id=p_user and created_at>now()-interval '10 seconds')
 then raise exception '다음 경기는 10초 후에 시작할 수 있어요' using errcode='22023'; end if;
 insert into public.rkbo_ladder_progress(user_id,season,cleared_count)
 values(p_user,p_season,0) on conflict do nothing;
 select cleared_count into v_cleared from public.rkbo_ladder_progress
 where user_id=p_user and season=p_season for update;
 if v_cleared >= p_total or p_rank <> p_total-v_cleared
 then raise exception '아직 해금되지 않은 상대입니다' using errcode='42501'; end if;
 v_result:=case when p_our_runs>p_cpu_runs then 'WIN'
                when p_our_runs<p_cpu_runs then 'LOSS' else 'DRAW' end;
 v_new:=v_cleared+case when v_result='WIN' then 1 else 0 end;
 insert into public.rkbo_ladder_matches(
 user_id,team_id,team_name,season,opponent_code,opponent_rank,
 our_runs,cpu_runs,result,innings,events,player_stats)
 values(p_user,p_team,v_team.name,p_season,p_opponent,p_rank,
 p_our_runs,p_cpu_runs,v_result,p_innings,p_events,p_stats) returning id into v_id;
 update public.rkbo_ladder_progress
 set cleared_count=v_new,updated_at=now()
 where user_id=p_user and season=p_season;
 return jsonb_build_object('id',v_id,'teamName',v_team.name,
 'ourRuns',p_our_runs,'cpuRuns',p_cpu_runs,'result',v_result,'innings',p_innings,
 'events',p_events,'playerStats',p_stats,'opponentCode',p_opponent,
 'opponentRank',p_rank,'season',p_season,'clearedCount',v_new,'total',p_total);
end;
$$;
revoke all on function public.rkbo_commit_ladder_match(uuid,uuid,integer,text,integer,integer,integer,integer,jsonb,jsonb,jsonb)
 from PUBLIC,anon,authenticated;
grant execute on function public.rkbo_commit_ladder_match(uuid,uuid,integer,text,integer,integer,integer,integer,jsonb,jsonb,jsonb)
 to service_role;
