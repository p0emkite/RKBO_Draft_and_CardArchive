-- MY TEAM: server-validated collectible 18-man club and 9-inning CPU exhibition.
-- All authoritative card data, ownership, lineup legality and match rolls live in PostgreSQL.
alter table public.rkbo_pack_cards add column if not exists ratings jsonb;

create table if not exists public.rkbo_owned_teams(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 2 and 40),
 slots jsonb not null check(jsonb_typeof(slots)='array' and jsonb_array_length(slots)=18),
 lineup jsonb not null check(jsonb_typeof(lineup)='object'),
 average_ovr numeric(4,1) not null,
 tpi integer not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists rkbo_owned_teams_owner on public.rkbo_owned_teams(user_id,updated_at desc);
alter table public.rkbo_owned_teams enable row level security;
revoke all on public.rkbo_owned_teams from public,anon,authenticated;
grant select on public.rkbo_owned_teams to authenticated;
drop policy if exists rkbo_owned_teams_select on public.rkbo_owned_teams;
create policy rkbo_owned_teams_select on public.rkbo_owned_teams for select to authenticated
 using((select auth.uid())=user_id);

create table if not exists public.rkbo_owned_matches(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 team_id uuid not null references public.rkbo_owned_teams(id) on delete cascade,
 team_name text not null,
 our_runs integer not null check(our_runs>=0),
 cpu_runs integer not null check(cpu_runs>=0),
 innings jsonb not null,
 events jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists rkbo_owned_matches_user on public.rkbo_owned_matches(user_id,created_at desc);
alter table public.rkbo_owned_matches enable row level security;
revoke all on public.rkbo_owned_matches from public,anon,authenticated;
grant select on public.rkbo_owned_matches to authenticated;
drop policy if exists rkbo_owned_matches_select on public.rkbo_owned_matches;
create policy rkbo_owned_matches_select on public.rkbo_owned_matches for select to authenticated
 using((select auth.uid())=user_id);

create or replace function public.rkbo_owned_perm(v jsonb,allowed text[])
returns boolean language sql immutable set search_path=''
as $$
select coalesce(
 jsonb_typeof(v)='array' and jsonb_array_length(v)=cardinality(allowed)
 and (select array_agg(x order by x) from jsonb_array_elements_text(v) e(x))
    =(select array_agg(x order by x) from unnest(allowed) e(x))
,false)
$$;
revoke all on function public.rkbo_owned_perm(jsonb,text[]) from public,anon,authenticated;

create or replace function public.rkbo_save_owned_team(
 p_name text,p_slots jsonb,p_lineup jsonb,p_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid();
 v_slot text;v_card_id text;v_player record;v_item jsonb;v_slot_card jsonb:='{}'::jsonb;
 v_seen_slots text[]:='{}';v_seen_ids text[]:='{}';v_ovrs integer[]:='{}';
 v_all text[]:=array['C','1B','2B','3B','SS','LF','CF','RF','DH','SP1','SP2','SP3','SP4','SP5','RP1','RP2','RP3','CP'];
 v_hit text[]:=array['C','1B','2B','3B','SS','LF','CF','RF','DH'];
 v_sp text[]:=array['SP1','SP2','SP3','SP4','SP5'];
 v_rp text[]:=array['RP1','RP2','RP3'];
 v_base text;v_def text;v_pos text;v_avg numeric;v_top numeric;v_low numeric;v_tpi integer;v_id uuid;
 v_ordered jsonb:='[]'::jsonb;v_count integer;
begin
 if v_user is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
 or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 then raise exception 'Google 로그인이 필요합니다' using errcode='28000';end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 40 then
 raise exception '팀 이름은 2~40자로 설정해 주세요' using errcode='22023';end if;
 if p_slots is null or jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots)<>18 then
 raise exception '선수 18명을 배치해야 합니다' using errcode='22023';end if;
 for v_item in select value from jsonb_array_elements(p_slots) loop
  v_slot:=v_item->>'slot';v_card_id:=v_item->>'cardId';
  if v_slot is null or not(v_slot=any(v_all)) or v_slot=any(v_seen_slots)
   or v_card_id is null or v_card_id=any(v_seen_ids)
  then raise exception '포지션 또는 중복 선수 배치 오류' using errcode='22023';end if;
  select p.position,p.card_type,p.ovr into v_player
   from public.rkbo_pack_cards p join public.rkbo_card_inventory i
   on i.card_id=p.card_id and i.user_id=v_user
   where p.card_id=v_card_id
     and (i.quantity>0 or i.gold_border or i.prism);
  if not found then raise exception '보유하지 않은 선수가 포함되어 있습니다' using errcode='22023';end if;
  if (v_slot=any(v_hit) and v_player.card_type<>'타자')
   or (v_slot='DH' and v_player.card_type<>'타자')
   or (v_slot<>'DH' and v_slot=any(v_hit) and v_player.position<>v_slot)
   or (v_slot=any(v_sp) and (v_player.card_type<>'투수' or v_player.position<>'SP'))
   or (v_slot=any(v_rp) and (v_player.card_type<>'투수' or v_player.position<>'RP'))
   or (v_slot='CP' and (v_player.card_type<>'투수' or v_player.position<>'CP'))
  then raise exception '선수의 본래 포지션과 맞지 않습니다: %',v_slot using errcode='22023';end if;
  v_seen_slots:=array_append(v_seen_slots,v_slot);
  v_seen_ids:=array_append(v_seen_ids,v_card_id);
  v_ovrs:=array_append(v_ovrs,v_player.ovr);
  v_slot_card:=v_slot_card||jsonb_build_object(v_slot,v_card_id);
  v_ordered:=v_ordered||jsonb_build_array(jsonb_build_object('slot',v_slot,'cardId',v_card_id,'ovr',v_player.ovr));
 end loop;
 if not public.rkbo_owned_perm(to_jsonb(v_seen_slots),v_all) then
 raise exception '18개 포지션이 모두 필요합니다' using errcode='22023';end if;
 if p_lineup is null or jsonb_typeof(p_lineup)<>'object'
  or not public.rkbo_owned_perm(p_lineup->'battingOrder',v_hit)
  or not public.rkbo_owned_perm(p_lineup->'rotation',v_sp)
  or not public.rkbo_owned_perm(p_lineup->'bullpen',v_rp)
  or p_lineup->'defense' is null or jsonb_typeof(p_lineup->'defense')<>'object'
  or (select count(*) from jsonb_object_keys(p_lineup->'defense'))<>9
  or not public.rkbo_owned_perm(
    (select jsonb_agg(p_lineup->'defense'->positions.slot_value) from unnest(v_hit) as positions(slot_value)),v_hit)
 then raise exception '타순·수비·투수진 배치 오류' using errcode='22023';end if;
 foreach v_base in array v_hit loop
  if v_base='DH' then continue;end if;
  v_def:=p_lineup->'defense'->>v_base;
  select p.position into v_pos from public.rkbo_pack_cards p
   where p.card_id=v_slot_card->>v_def;
  if v_pos is distinct from v_base then
   raise exception '수비수는 본래 포지션 또는 DH로만 배치할 수 있습니다' using errcode='22023';end if;
 end loop;
 select avg(n) into v_avg from unnest(v_ovrs) n;
 select avg(n) into v_top from (select n from unnest(v_ovrs) n order by n desc limit 6) q;
 select avg(n) into v_low from (select n from unnest(v_ovrs) n order by n asc limit 6) q;
 v_tpi:=round((v_avg*.7+v_top*.2+v_low*.1)*10);
 if p_id is null then
  insert into public.rkbo_owned_teams(user_id,name,slots,lineup,average_ovr,tpi)
  values(v_user,btrim(p_name),v_ordered,p_lineup,round(v_avg,1),v_tpi) returning id into v_id;
 else
  update public.rkbo_owned_teams set name=btrim(p_name),slots=v_ordered,lineup=p_lineup,
   average_ovr=round(v_avg,1),tpi=v_tpi,updated_at=now()
  where id=p_id and user_id=v_user returning id into v_id;
  if v_id is null then raise exception '수정할 팀을 찾을 수 없습니다' using errcode='22023';end if;
 end if;
 return jsonb_build_object('id',v_id,'averageOVR',round(v_avg,1),'tpi',v_tpi);
end;
$$;
revoke all on function public.rkbo_save_owned_team(text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.rkbo_save_owned_team(text,jsonb,jsonb,uuid) to authenticated;

create or replace function public.rkbo_delete_owned_team(p_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid();v_count integer;
begin
 if v_user is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then
 raise exception '로그인이 필요합니다' using errcode='28000';end if;
 delete from public.rkbo_owned_teams where id=p_id and user_id=v_user;
 get diagnostics v_count=row_count;
 return v_count=1;
end;
$$;
revoke all on function public.rkbo_delete_owned_team(uuid) from public,anon,authenticated;
grant execute on function public.rkbo_delete_owned_team(uuid) to authenticated;

-- Ratings-backed 9-inning CPU exhibition. Player batting ability, power,
-- patience, fielding and pitching ratings feed every server-side at-bat.
create or replace function public.rkbo_play_owned_match(p_team_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid();v_team public.rkbo_owned_teams%rowtype;
 v_inning integer;v_half integer;v_outs integer;v_pa integer;v_runs integer;
 v_cpu_total integer:=0;v_our_total integer:=0;v_cpu_order integer:=0;v_our_order integer:=0;
 v_contact numeric;v_power numeric;v_patience numeric;v_field numeric:=75;
 v_pitch numeric;v_control numeric;v_hit numeric;v_homer numeric;v_roll float8;
 v_slot text;v_card_id text;v_name text;v_pitch_slot text;v_pitch_id text;
 v_player record;v_pitcher record;v_base1 integer;v_base2 integer;v_base3 integer;
 v_event text;v_scored integer;v_result jsonb:='[]'::jsonb;v_events jsonb:='[]'::jsonb;
 v_our_inning integer[]:=array[]::integer[];v_cpu_inning integer[]:=array[]::integer[];
 v_id uuid;v_i integer;v_validation integer;
begin
 if v_user is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
 or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 then raise exception 'Google 로그인이 필요합니다' using errcode='28000';end if;
 select * into v_team from public.rkbo_owned_teams where id=p_team_id and user_id=v_user;
 if not found then raise exception '먼저 본인 MY TEAM을 저장해 주세요' using errcode='22023';end if;
 select count(*) into v_validation from jsonb_array_elements(v_team.slots) j
 join public.rkbo_card_inventory inv on inv.card_id=j->>'cardId' and inv.user_id=v_user
 where inv.quantity>0 or inv.gold_border or inv.prism;
 if v_validation<>18 then raise exception '보유 카드가 부족하거나 선수단에 문제가 있어요' using errcode='22023';end if;
 select avg(coalesce((p.ratings->>'수비')::numeric,p.ovr))
  into v_field from jsonb_array_elements(v_team.slots) j
  join public.rkbo_pack_cards p on p.card_id=j->>'cardId'
  where j->>'slot' in ('C','1B','2B','3B','SS','LF','CF','RF');
 for v_inning in 1..9 loop
  for v_half in 1..2 loop
   v_outs:=0;v_pa:=0;v_runs:=0;v_base1:=0;v_base2:=0;v_base3:=0;
   while v_outs<3 and v_pa<20 loop
    v_pa:=v_pa+1;
    if v_half=1 then
     v_cpu_order:=v_cpu_order+1;
     v_contact:=74+(v_cpu_order*7)%18;
     v_power:=73+(v_cpu_order*11)%20;
     v_patience:=70+(v_cpu_order*13)%22;
     v_name:='CPU 타자 '||(((v_cpu_order-1)%9)+1);
     v_pitch_slot:=case when v_inning<=5 then v_team.lineup->'rotation'->>(v_inning-1)
                         when v_inning<9 then v_team.lineup->'bullpen'->>(v_inning-6)
                         else 'CP' end;
     select j->>'cardId' into v_pitch_id from jsonb_array_elements(v_team.slots) j
      where j->>'slot'=v_pitch_slot;
     select ratings,ovr into v_pitcher from public.rkbo_pack_cards where card_id=v_pitch_id;
     v_pitch:=coalesce((v_pitcher.ratings->>'구위')::numeric,v_pitcher.ovr);
     v_control:=coalesce((v_pitcher.ratings->>'제구')::numeric,v_pitcher.ovr);
    else
     v_our_order:=v_our_order+1;
     v_slot:=v_team.lineup->'battingOrder'->>((v_our_order-1)%9);
     select j->>'cardId' into v_card_id from jsonb_array_elements(v_team.slots) j where j->>'slot'=v_slot;
     select name,ratings,ovr into v_player from public.rkbo_pack_cards where card_id=v_card_id;
     v_name:=v_player.name;
     v_contact:=coalesce((v_player.ratings->>'정확')::numeric,v_player.ovr);
     v_power:=coalesce((v_player.ratings->>'파워')::numeric,v_player.ovr);
     v_patience:=coalesce((v_player.ratings->>'선구')::numeric,v_player.ovr);
     v_pitch:=81;v_control:=80;
    end if;
    v_hit:=greatest(.11,least(.41,.245+(v_contact-80)*.003-(v_pitch-80)*.003
                        +case when v_half=1 then (75-coalesce(v_field,75))*.001 else 0 end));
    v_homer:=greatest(.008,least(.075,.025+(v_power-80)*.0012-(v_pitch-80)*.0005));
    v_roll:=random();v_scored:=0;
    if v_roll<greatest(.03,least(.14,.075+(v_patience-80)*.0015-(v_control-80)*.0006)) then
     v_event:='볼넷';
     if v_base1=1 and v_base2=1 and v_base3=1 then v_scored:=1;end if;
     if v_base1=1 and v_base2=1 then v_base3:=1;end if;
     if v_base1=1 then v_base2:=1;end if;v_base1:=1;
    elsif v_roll<v_hit then
     v_roll:=random();
     if v_roll<v_homer then
      v_event:='홈런';v_scored:=1+v_base1+v_base2+v_base3;v_base1:=0;v_base2:=0;v_base3:=0;
     elsif v_roll<.11 then
      v_event:='3루타';v_scored:=v_base1+v_base2+v_base3;v_base1:=0;v_base2:=0;v_base3:=1;
     elsif v_roll<.34 then
      v_event:='2루타';v_scored:=v_base2+v_base3;v_base3:=v_base1;v_base2:=1;v_base1:=0;
     else
      v_event:='안타';v_scored:=v_base2+v_base3;v_base2:=v_base1;v_base1:=1;v_base3:=0;
     end if;
    else
     v_outs:=v_outs+1;
     v_event:=case when random()<.48 then '삼진' else '범타' end;
    end if;
    v_runs:=v_runs+v_scored;
    if jsonb_array_length(v_events)<270 then
     v_events:=v_events||jsonb_build_array(jsonb_build_object(
       'inning',v_inning,'half',case when v_half=1 then '초' else '말' end,
       'batter',v_name,'result',v_event,'rbi',v_scored,'outs',v_outs));
    end if;
   end loop;
   if v_half=1 then
    v_cpu_total:=v_cpu_total+v_runs;v_cpu_inning:=array_append(v_cpu_inning,v_runs);
   else
    v_our_total:=v_our_total+v_runs;v_our_inning:=array_append(v_our_inning,v_runs);
   end if;
  end loop;
 end loop;
 for v_i in 1..9 loop
  v_result:=v_result||jsonb_build_array(jsonb_build_object(
   'inning',v_i,'cpu',v_cpu_inning[v_i],'ours',v_our_inning[v_i]));
 end loop;
 insert into public.rkbo_owned_matches(user_id,team_id,team_name,our_runs,cpu_runs,innings,events)
 values(v_user,v_team.id,v_team.name,v_our_total,v_cpu_total,v_result,v_events)
 returning id into v_id;
 return jsonb_build_object('id',v_id,'teamName',v_team.name,'ourRuns',v_our_total,
 'cpuRuns',v_cpu_total,'innings',v_result,'events',v_events,
 'result',case when v_our_total>v_cpu_total then 'WIN'
 when v_our_total<v_cpu_total then 'LOSS' else 'DRAW' end);
end;
$$;
revoke all on function public.rkbo_play_owned_match(uuid) from public,anon,authenticated;
grant execute on function public.rkbo_play_owned_match(uuid) to authenticated;
