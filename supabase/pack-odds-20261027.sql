-- HISTORICAL ONLY (2026-10-27). DO NOT REAPPLY to production.
-- Current server implementation: supabase/pack-odds-20261031-trt-premium-pity.sql
-- RKBO regular pack drop probabilities (applies to every active season):
-- Bronze 46.5%, Silver 31.5%, Gold 15%, Coral 5%, Diamond 1%, Specials 1%.
-- Existing 50-pack diamond guarantee, 5-card independent draws and special uniform pool remain.
-- If a season has no special cards, redistribute their 1% proportionally among standard grades.
CREATE OR REPLACE FUNCTION public.rkbo_open_card_pack(p_season integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 v_previously_owned boolean;
 v_selected_special boolean := false;
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
 -- Measure the cooldown after acquiring the row lock, not before waiting for it.
 v_now:=clock_timestamp();
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
  v_selected_special:=false;
  v_grade:=case when v_force and i=5 then '다이아몬드'
   when v_roll < 0.465 then '브론즈'
   when v_roll < 0.78 then '실버'
   when v_roll < 0.93 then '골드'
   when v_roll < 0.98 then '코랄'
   when v_roll < 0.99 then '다이아몬드'
   else '__SPECIAL__' end;
  if v_grade='__SPECIAL__' then
   select c.card_id,c.name,c.team,c.position,c.ovr,c.grade into v_card
   from public.rkbo_pack_special_registry r
   join public.rkbo_pack_cards c on c.card_id=r.card_id
   where r.season=p_season and r.active
   order by random() limit 1;
   if found then
    v_grade:=v_card.grade;
    v_selected_special:=true;
   else
    -- An empty special pool causes the reserved 2.5% to redistribute
    -- proportionally among the five standard rarities, not fail the pack.
    v_roll:=(v_roll-0.99)*99;
    v_grade:=case when v_roll < 0.465 then '브론즈'
     when v_roll < 0.78 then '실버'
     when v_roll < 0.93 then '골드'
     when v_roll < 0.98 then '코랄'
     else '다이아몬드' end;
   end if;
  end if;
  if not v_selected_special then
   select card_id,name,team,position,ovr,grade into v_card
   from public.rkbo_pack_cards
   where season=p_season and grade=v_grade
   order by random() limit 1;
  end if;
  if not found then raise exception '시즌별 카드풀이 아직 준비되지 않았습니다' using errcode='22023'; end if;
  select exists(select 1 from public.rkbo_card_inventory where user_id=v_user and card_id=v_card.card_id) into v_previously_owned;
  insert into public.rkbo_card_inventory(user_id,card_id,quantity)
   values(v_user,v_card.card_id,1)
  on conflict(user_id,card_id) do update
   set quantity=public.rkbo_card_inventory.quantity+1,last_acquired_at=clock_timestamp()
  returning quantity into v_quantity;
  v_draws:=v_draws||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'cardId',v_card.card_id,'grade',v_grade,'name',v_card.name,'team',v_card.team,
   'pos',v_card.position,'ovr',v_card.ovr,'quantity',v_quantity,'isNew',not v_previously_owned
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
$function$

