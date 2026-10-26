-- RKBO standard season packs and special-card server eligibility.
-- Apply after the original card-pack system and pack-admin-upgrades migrations.
-- This preserves historical draws, inventory, 50-pack diamond pity and administrator permissions.
BEGIN;
ALTER TABLE public.rkbo_pack_cards DROP CONSTRAINT IF EXISTS rkbo_pack_cards_grade_check;
ALTER TABLE public.rkbo_pack_cards ADD CONSTRAINT rkbo_pack_cards_grade_check
  CHECK(grade IN ('브론즈','실버','골드','코랄','다이아몬드','신인왕','드림','나눔','MVP','베스트릴리프'));
CREATE TABLE IF NOT EXISTS public.rkbo_pack_special_registry(
 card_id text PRIMARY KEY REFERENCES public.rkbo_pack_cards(card_id) ON DELETE RESTRICT,
 season integer NOT NULL CHECK(season BETWEEN 1 AND 60),
 base_card_id text NOT NULL REFERENCES public.rkbo_pack_cards(card_id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('ROY','DREAM','NANUM','MVP','RELIEF')),
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(base_card_id,kind)
);
CREATE INDEX IF NOT EXISTS rkbo_pack_special_active_idx ON public.rkbo_pack_special_registry(season,active);
ALTER TABLE public.rkbo_pack_special_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_pack_special_registry FROM anon,authenticated;

-- RPC: rkbo_manage_pack
CREATE OR REPLACE FUNCTION public.rkbo_manage_pack(p_season integer, p_label text, p_image_url text, p_active boolean, p_cards jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_card jsonb;
 v_pos text;
 v_id text;
 v_grade text;
 v_count integer;
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'role','') <> 'authenticated'
    or not public.rkbo_is_pack_admin() then
  raise exception '제작자 계정만 팩을 관리할 수 있습니다' using errcode='42501';
 end if;
 if p_season is null or p_season not between 1 and 60 then
  raise exception '차수는 1~60 사이여야 합니다' using errcode='22023';
 end if;
 if length(btrim(coalesce(p_label,''))) not between 2 and 70 then
  raise exception '팩 이름은 2~70자로 지정해 주세요' using errcode='22023';
 end if;
 if length(coalesce(p_image_url,''))>700 or
  not (
   p_image_url like 'https://raw.githubusercontent.com/p0emkite/%' or
   p_image_url like 'https://stajnaagugudgsabntuq.supabase.co/storage/v1/object/public/rkbo-pack-art/%'
  ) then raise exception '허용된 팩 이미지 주소가 아닙니다' using errcode='22023';
 end if;
 if p_cards is not null then
  if jsonb_typeof(p_cards)<>'array' or jsonb_array_length(p_cards) not between 1 and 1000 then
   raise exception '공식 카드 목록은 1~1000개 배열이어야 합니다' using errcode='22023';
  end if;
  for v_card in select value from jsonb_array_elements(p_cards) loop
   v_id:=v_card->>'id';
   v_grade:=v_card->>'grade';
   v_pos:=v_card->>'pos';
   if v_id is null or left(v_id,length(p_season::text)+1)<>p_season::text||'-'
    or length(v_id)>120 or
    coalesce(v_grade,'') not in ('브론즈','실버','골드','코랄','다이아몬드') or
    length(coalesce(v_card->>'name','')) not between 1 and 100 or
    length(coalesce(v_card->>'team','')) not between 1 and 20 or
    length(coalesce(v_pos,'')) not between 1 and 12 or
    coalesce(v_card->>'type','') not in ('타자','투수') or
    (v_card->>'ovr') is null or
    (v_card->>'ovr') !~ '^[0-9]{1,2}$' or
    (v_card->>'ovr')::integer not between 1 and 99 then
     raise exception '차수/선수/등급 데이터가 올바르지 않습니다' using errcode='22023';
   end if;
   insert into public.rkbo_pack_cards(card_id,season,grade,name,team,position,card_type,ovr)
   values(v_id,p_season,v_grade,v_card->>'name',v_card->>'team',v_pos,v_card->>'type',(v_card->>'ovr')::integer)
   on conflict(card_id) do update set
    grade=excluded.grade,name=excluded.name,team=excluded.team,
    position=excluded.position,card_type=excluded.card_type,ovr=excluded.ovr;
  end loop;
 end if;
 if coalesce(p_active,false) then
  select count(distinct grade) filter (where grade in ('브론즈','실버','골드','코랄','다이아몬드')) into v_count from public.rkbo_pack_cards where season=p_season;
  if v_count<>5 then
   raise exception '브론즈~다이아몬드 5개 등급이 있는 시즌만 활성화할 수 있습니다' using errcode='22023';
  end if;
 end if;
 insert into public.rkbo_pack_settings(season,label,image_url,active,updated_at)
 values(p_season,btrim(p_label),p_image_url,coalesce(p_active,false),now())
 on conflict(season) do update set label=excluded.label,image_url=excluded.image_url,
   active=excluded.active,updated_at=now();
 return jsonb_build_object('season',p_season,'active',coalesce(p_active,false),'success',true);
end;
$function$;

-- RPC: rkbo_open_card_pack
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
   when v_roll < 0.45 then '브론즈'
   when v_roll < 0.75 then '실버'
   when v_roll < 0.90 then '골드'
   when v_roll < 0.95 then '코랄'
   when v_roll < 0.975 then '다이아몬드'
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
    v_roll:=(v_roll-0.975)*39;
    v_grade:=case when v_roll < 0.45 then '브론즈'
     when v_roll < 0.75 then '실버'
     when v_roll < 0.90 then '골드'
     when v_roll < 0.95 then '코랄'
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
$function$;

-- RPC: rkbo_sync_special_cards
CREATE OR REPLACE FUNCTION public.rkbo_sync_special_cards(p_season integer, p_cards jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_item jsonb; v_base public.rkbo_pack_cards%rowtype;
 v_id text; v_kind text; v_bonus integer; v_grade text; v_ratings jsonb;
 v_seen text[]:=ARRAY[]::text[]; v_count integer:=0;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
    OR NOT public.rkbo_is_pack_admin() THEN
  RAISE EXCEPTION 'Supabase 제작자 계정만 특수카드를 카드팩에 등록할 수 있습니다' USING ERRCODE='42501';
 END IF;
 IF p_season NOT BETWEEN 1 AND 60 OR jsonb_typeof(p_cards) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_cards)>500 THEN
   RAISE EXCEPTION '특수카드 차수/배열이 잘못되었습니다' USING ERRCODE='22023';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(521260,p_season);
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
  v_kind:=v_item->>'kind';v_id:=v_item->>'baseId';
  IF v_kind NOT IN ('ROY','DREAM','NANUM','MVP','RELIEF') OR v_id IS NULL
    OR length(v_id)>105 OR left(v_id,length(p_season::text)+1)<>p_season::text||'-' THEN
   RAISE EXCEPTION '잘못된 특수카드 원본/등급' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_base FROM public.rkbo_pack_cards
    WHERE card_id=v_id AND season=p_season AND grade IN ('브론즈','실버','골드','코랄','다이아몬드');
  IF NOT FOUND THEN RAISE EXCEPTION '서버에 원본 카드가 없습니다: %',v_id USING ERRCODE='22023'; END IF;
  IF (v_kind='DREAM' AND v_base.team NOT IN ('SAM','LOT','DOO','SSG','SK'))
  OR (v_kind='NANUM' AND v_base.team NOT IN ('KIA','HAN','LG','NC'))
  OR (v_kind='RELIEF' AND (v_base.card_type<>'투수' OR v_base.position<>'RP')) THEN
   RAISE EXCEPTION '해당 구단/포지션의 특수카드가 아닙니다' USING ERRCODE='22023';
  END IF;
  v_bonus:=CASE WHEN v_kind IN ('DREAM','NANUM') THEN 3 ELSE 5 END;
  v_grade:=CASE v_kind WHEN 'ROY' THEN '신인왕' WHEN 'DREAM' THEN '드림'
   WHEN 'NANUM' THEN '나눔' WHEN 'MVP' THEN 'MVP' ELSE '베스트릴리프' END;
  v_id:=v_base.card_id||'-SPECIAL-'||v_kind;
  IF v_id=ANY(v_seen) THEN RAISE EXCEPTION '중복 특수카드: %',v_id USING ERRCODE='22023'; END IF;
  v_seen:=array_append(v_seen,v_id);
  SELECT jsonb_object_agg(key,CASE WHEN jsonb_typeof(value)='number'
    THEN to_jsonb(least(99,round((value#>>'{}')::numeric)::integer+v_bonus)) ELSE value END)
    INTO v_ratings FROM jsonb_each(coalesce(v_base.ratings,'{}'::jsonb));
  INSERT INTO public.rkbo_pack_cards(card_id,season,grade,name,team,position,card_type,ovr,ratings)
   VALUES(v_id,p_season,v_grade,v_base.name,v_base.team,v_base.position,v_base.card_type,
    least(99,v_base.ovr+v_bonus),v_ratings)
   ON CONFLICT(card_id) DO UPDATE SET grade=excluded.grade,name=excluded.name,
    team=excluded.team,position=excluded.position,card_type=excluded.card_type,
    ovr=excluded.ovr,ratings=excluded.ratings;
  INSERT INTO public.rkbo_pack_special_registry(card_id,season,base_card_id,kind,active,updated_at)
   VALUES(v_id,p_season,v_base.card_id,v_kind,true,now())
   ON CONFLICT(card_id) DO UPDATE SET active=true,updated_at=now();
  v_count:=v_count+1;
 END LOOP;
 UPDATE public.rkbo_pack_special_registry SET active=false,updated_at=now()
 WHERE season=p_season AND active AND NOT(card_id=ANY(v_seen));
 RETURN jsonb_build_object('season',p_season,'activeSpecialCards',v_count,'success',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.rkbo_sync_special_cards(integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_sync_special_cards(integer,jsonb) TO authenticated;
COMMIT;
-- Run the authenticated admin sync RPC with the current season's GitHub
-- data/special-cards.json manifest to enable existing specials in the pack pool.
