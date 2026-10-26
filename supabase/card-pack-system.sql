-- RKBO ONLINE card packs v1: 60 season, five independent rarity draws (45/30/15/7/3).
-- No purchases, no currency. Atomic, server-only draws and owner-only inventory.
create table if not exists public.rkbo_pack_cards(
 card_id text primary key,
 season integer not null check(season between 1 and 999),
 grade text not null check(grade in ('브론즈','실버','골드','코랄','다이아몬드')),
 name text not null,
 team text not null,
 position text not null,
 card_type text not null,
 ovr integer not null check(ovr between 1 and 99)
);
create index if not exists rkbo_pack_cards_season_grade on public.rkbo_pack_cards(season,grade);
create table if not exists public.rkbo_card_inventory(
 user_id uuid not null references auth.users(id) on delete cascade,
 card_id text not null references public.rkbo_pack_cards(card_id),
 quantity integer not null check(quantity>0),
 first_acquired_at timestamptz not null default now(),
 last_acquired_at timestamptz not null default now(),
 primary key(user_id,card_id)
);
create table if not exists public.rkbo_pack_state(
 user_id uuid primary key references auth.users(id) on delete cascade,
 total_packs integer not null default 0 check(total_packs>=0),
 no_diamond_streak integer not null default 0 check(no_diamond_streak>=0),
 last_open_at timestamptz
);
create table if not exists public.rkbo_pack_history(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 pack_number integer not null check(pack_number>0),
 season integer not null,
 draws jsonb not null check(jsonb_typeof(draws)='array' and jsonb_array_length(draws)=5),
 opened_at timestamptz not null default now(),
 unique(user_id,pack_number)
);
create index if not exists rkbo_pack_history_owner_time on public.rkbo_pack_history(user_id,opened_at desc);

alter table public.rkbo_pack_cards enable row level security;
alter table public.rkbo_card_inventory enable row level security;
alter table public.rkbo_pack_state enable row level security;
alter table public.rkbo_pack_history enable row level security;
revoke all on public.rkbo_pack_cards,public.rkbo_card_inventory,public.rkbo_pack_state,public.rkbo_pack_history from public,anon,authenticated;
grant select on public.rkbo_pack_cards to anon,authenticated;
grant select on public.rkbo_card_inventory,public.rkbo_pack_state,public.rkbo_pack_history to authenticated;
drop policy if exists rkbo_pack_cards_read on public.rkbo_pack_cards;
create policy rkbo_pack_cards_read on public.rkbo_pack_cards for select to anon,authenticated using(true);
drop policy if exists rkbo_inventory_own_read on public.rkbo_card_inventory;
create policy rkbo_inventory_own_read on public.rkbo_card_inventory for select to authenticated using((select auth.uid())=user_id);
drop policy if exists rkbo_pack_state_own_read on public.rkbo_pack_state;
create policy rkbo_pack_state_own_read on public.rkbo_pack_state for select to authenticated using((select auth.uid())=user_id);
drop policy if exists rkbo_pack_history_own_read on public.rkbo_pack_history;
create policy rkbo_pack_history_own_read on public.rkbo_pack_history for select to authenticated using((select auth.uid())=user_id);

create or replace function public.rkbo_open_card_pack(p_season integer default 60)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid := auth.uid();
 v_role text := auth.jwt()->>'role'; -- Current PostgREST JWT claim accessor; legacy request.jwt.claim.role can be absent.
 v_state public.rkbo_pack_state%rowtype;
 v_now timestamptz := clock_timestamp();
 v_pack_number integer;
 v_force boolean;
 v_hit boolean := false;
 v_roll numeric;
 v_bytes bytea;
 v_grade text;
 v_card record;
 v_quantity integer;
 v_draws jsonb := '[]'::jsonb;
 i integer;
begin
 if v_user is null or coalesce(v_role,'') <> 'authenticated' or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception 'Google 로그인이 필요합니다' using errcode='28000';
 end if;
 if p_season is null or not exists(
  select 1 from public.rkbo_pack_settings where season=p_season and active
 ) then
  raise exception '선택한 시즌의 카드팩은 현재 개봉할 수 없습니다' using errcode='22023';
 end if;
 insert into public.rkbo_pack_state(user_id) values(v_user) on conflict do nothing;
 select * into strict v_state from public.rkbo_pack_state where user_id=v_user for update;
 if v_state.last_open_at is not null and v_now<v_state.last_open_at+interval '5 seconds' then
  raise exception '다음 카드팩은 잠시 후 열 수 있습니다 (5초 간격)' using errcode='22023';
 end if;
 v_pack_number:=v_state.total_packs+1;
 v_force:=v_state.no_diamond_streak>=49;
 for i in 1..5 loop
  v_bytes:=extensions.gen_random_bytes(4);
  v_roll:=(pg_catalog.get_byte(v_bytes,0)::numeric*16777216+
   pg_catalog.get_byte(v_bytes,1)::numeric*65536+
   pg_catalog.get_byte(v_bytes,2)::numeric*256+
   pg_catalog.get_byte(v_bytes,3)::numeric)/4294967296;
  v_grade:=case when v_force and i=5 then '다이아몬드'
   when v_roll < 0.45 then '브론즈'
   when v_roll < 0.75 then '실버'
   when v_roll < 0.90 then '골드'
   when v_roll < 0.97 then '코랄'
   else '다이아몬드' end;
  select card_id,name,team,position,ovr into v_card
  from public.rkbo_pack_cards
  where season=p_season and grade=v_grade
  order by random() limit 1;
  if not found then raise exception '시즌별 카드풀이 아직 준비되지 않았습니다' using errcode='22023'; end if;
  insert into public.rkbo_card_inventory(user_id,card_id,quantity)
   values(v_user,v_card.card_id,1)
  on conflict(user_id,card_id) do update
   set quantity=public.rkbo_card_inventory.quantity+1,last_acquired_at=clock_timestamp()
  returning quantity into v_quantity;
  v_draws:=v_draws||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'cardId',v_card.card_id,'grade',v_grade,'name',v_card.name,'team',v_card.team,
   'pos',v_card.position,'ovr',v_card.ovr,'quantity',v_quantity,'isNew',v_quantity=1
  ));
  if v_grade='다이아몬드' then v_hit:=true;end if;
 end loop;
 update public.rkbo_pack_state
 set total_packs=v_pack_number,
  no_diamond_streak=case when v_hit then 0 else v_state.no_diamond_streak+1 end,
  last_open_at=v_now
 where user_id=v_user;
 insert into public.rkbo_pack_history(user_id,pack_number,season,draws)
 values(v_user,v_pack_number,p_season,v_draws);
 return pg_catalog.jsonb_build_object('packNumber',v_pack_number,'season',p_season,
  'draws',v_draws,'noDiamondStreak',case when v_hit then 0 else v_state.no_diamond_streak+1 end,
  'hitDiamond',v_hit,'pityTriggered',v_force);
end;
$$;
revoke all on function public.rkbo_open_card_pack(integer) from public,anon,authenticated;
grant execute on function public.rkbo_open_card_pack(integer) to authenticated;
comment on function public.rkbo_open_card_pack(integer) is 'Atomic free five-card server draws. Requires authenticated user; respects 5-second cooldown and 50-pack diamond guarantee.';
