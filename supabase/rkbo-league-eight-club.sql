-- RKBO LEAGUE release: 8 clubs; remove KT and KIW.
-- 18 rounds * 8 clubs = 144 picks. 36 weeks * 16 games = 576 games.
-- Each club plays four games per week, totalling 144.
ALTER TABLE public.rkbo_league_members DROP CONSTRAINT rkbo_league_members_club_check;
ALTER TABLE public.rkbo_league_members ADD CONSTRAINT rkbo_league_members_club_check
 CHECK (club IN ('KIA','HAN','SAM','LOT','LG','DOO','SSG','NC'));
ALTER TABLE public.rkbo_league_rights DROP CONSTRAINT rkbo_league_rights_pick_check;
ALTER TABLE public.rkbo_league_rights ADD CONSTRAINT rkbo_league_rights_pick_check CHECK (pick BETWEEN 1 AND 8);
ALTER TABLE public.rkbo_league_games DROP CONSTRAINT rkbo_league_games_game_no_check;
ALTER TABLE public.rkbo_league_games ADD CONSTRAINT rkbo_league_games_game_no_check CHECK (game_no BETWEEN 1 AND 576);

-- rkbo_league_action
CREATE OR REPLACE FUNCTION public.rkbo_league_action(p_action text, p_room uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_club text DEFAULT NULL::text, p_visibility text DEFAULT 'public'::text, p_mode text DEFAULT 'multi'::text, p_season integer DEFAULT 60, p_code text DEFAULT NULL::text, p_card text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid:=auth.uid();r public.rkbo_league_rooms%rowtype;v_code text;
 v_order text[]:=ARRAY['KIA','HAN','SAM','LOT','LG','DOO','SSG','NC'];
 v_club text;v_slot text;v_round int;v_turn int;v_right text;v_card jsonb;v_counter int;v_owner uuid;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
   OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인 후 이용해 줘' USING ERRCODE='28000';
 END IF;
 IF p_action='create' THEN
  IF p_club IS NULL OR p_club<>ALL(v_order) OR p_visibility NOT IN('public','code')
   OR p_mode NOT IN('solo','multi') OR length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 48
   OR NOT EXISTS(SELECT 1 FROM public.rkbo_pack_cards WHERE season=p_season) THEN
   RAISE EXCEPTION '방 이름·구단·모드·시즌을 확인해 줘' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.rkbo_league_rooms(host_id,name,visibility,mode,season)
  VALUES(u,btrim(p_name),p_visibility,p_mode,p_season) RETURNING * INTO r;
  INSERT INTO public.rkbo_league_members(room_id,club,user_id,is_ai)
  VALUES(r.id,p_club,u,false);
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  INSERT INTO public.rkbo_league_invites(room_id,code_hash) VALUES(r.id,md5(v_code));
  RETURN jsonb_build_object('roomId',r.id,'inviteCode',v_code,'visibility',r.visibility);
 END IF;
 IF p_action='join_code' THEN
  SELECT room_id INTO p_room FROM public.rkbo_league_invites WHERE code_hash=md5(upper(trim(coalesce(p_code,''))));
  IF p_room IS NULL THEN RAISE EXCEPTION '유효하지 않은 초대 코드야' USING ERRCODE='22023';END IF;
 END IF;
 IF p_room IS NULL THEN RAISE EXCEPTION '방을 선택해 줘' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM public.rkbo_league_rooms WHERE id=p_room FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '방이 없어';END IF;
 IF p_action IN('join','join_code') THEN
  IF r.phase<>'lobby' THEN RAISE EXCEPTION '이미 시작한 방이야';END IF;
  IF p_action='join' AND r.visibility='code' AND NOT EXISTS(SELECT 1 FROM public.rkbo_league_members WHERE room_id=p_room AND user_id=u) THEN
   RAISE EXCEPTION '초대 코드로 참가해야 해';END IF;
  IF p_club IS NULL OR p_club<>ALL(v_order) THEN RAISE EXCEPTION 'RKBO 8개 구단 중 선택해 줘';END IF;
  IF EXISTS(SELECT 1 FROM public.rkbo_league_members WHERE room_id=p_room AND user_id=u) THEN
   RETURN jsonb_build_object('roomId',p_room,'joined',true,'alreadyJoined',true);
  END IF;
  INSERT INTO public.rkbo_league_members(room_id,club,user_id,is_ai)
   VALUES(p_room,p_club,u,false);
  RETURN jsonb_build_object('roomId',p_room,'joined',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rkbo_league_members WHERE room_id=p_room AND user_id=u)
   AND r.host_id<>u THEN RAISE EXCEPTION '이 방의 참가자가 아니야' USING ERRCODE='42501';END IF;
 IF p_action='start' THEN
  IF r.host_id<>u OR r.phase<>'lobby' THEN RAISE EXCEPTION '방장만 대기실에서 시작할 수 있어';END IF;
  IF r.mode='solo' AND (SELECT count(*) FROM public.rkbo_league_members WHERE room_id=p_room AND NOT is_ai)<>1 THEN
   RAISE EXCEPTION '혼자 플레이하는 모드야';END IF;
  FOREACH v_club IN ARRAY v_order LOOP
   INSERT INTO public.rkbo_league_members(room_id,club,user_id,is_ai)
    VALUES(p_room,v_club,NULL,true) ON CONFLICT DO NOTHING;
  END LOOP;
  FOR v_round IN 1..18 LOOP
   FOR v_turn IN 1..8 LOOP
    v_club:=v_order[CASE WHEN v_round%2=1 THEN v_turn ELSE 9-v_turn END];
    INSERT INTO public.rkbo_league_rights(room_id,round,pick,original_club,owner_club)
     VALUES(p_room,v_round,v_turn,v_club,v_club);
   END LOOP;
  END LOOP;
  UPDATE public.rkbo_league_rooms SET phase='draft',draft_round=1,draft_turn=1,updated_at=now() WHERE id=p_room;
  PERFORM public.rkbo_league_process(p_room,false);
  RETURN jsonb_build_object('roomId',p_room,'started',true);
 END IF;
 IF p_action='tick' THEN
  IF r.phase='draft' THEN PERFORM public.rkbo_league_process(p_room,false);END IF;
  RETURN jsonb_build_object('roomId',p_room,'phase',(SELECT phase FROM public.rkbo_league_rooms WHERE id=p_room));
 END IF;
 IF p_action='pick' THEN
  IF r.phase<>'draft' THEN RAISE EXCEPTION '현재 드래프트 중이 아니야';END IF;
  SELECT owner_club INTO v_club FROM public.rkbo_league_rights
   WHERE room_id=p_room AND round=r.draft_round AND pick=r.draft_turn;
  IF NOT EXISTS(SELECT 1 FROM public.rkbo_league_members WHERE room_id=p_room AND club=v_club AND user_id=u) THEN
   RAISE EXCEPTION '지금은 네 지명 차례가 아니야' USING ERRCODE='42501';END IF;
  SELECT x INTO v_card FROM jsonb_array_elements(r.draft_candidates) x WHERE x->>'cardId'=p_card;
  IF v_card IS NULL THEN RAISE EXCEPTION '현재 후보 15명 중 선택해 줘';END IF;
  v_slot:=public.rkbo_league_slot(r.draft_round);
  INSERT INTO public.rkbo_league_picks(room_id,round,pick,club,slot,card_id)
   VALUES(p_room,r.draft_round,r.draft_turn,v_club,v_slot,p_card);
  UPDATE public.rkbo_league_members SET roster=jsonb_set(roster,ARRAY[v_slot],v_card,true)
   WHERE room_id=p_room AND club=v_club;
  UPDATE public.rkbo_league_rooms SET
   draft_round=CASE WHEN draft_turn=8 THEN draft_round+1 ELSE draft_round END,
   draft_turn=CASE WHEN draft_turn=8 THEN 1 ELSE draft_turn+1 END,
   current_club=NULL,current_slot=NULL,draft_candidates='[]'::jsonb,expires_at=NULL,updated_at=now()
   WHERE id=p_room;
  PERFORM public.rkbo_league_process(p_room,false);
  RETURN jsonb_build_object('cardId',p_card,'club',v_club,'slot',v_slot);
 END IF;
 RAISE EXCEPTION '지원하지 않는 동작: %',p_action;
END;$function$;

-- rkbo_league_day_club
CREATE OR REPLACE FUNCTION public.rkbo_league_day_club(p_day integer, p_pos integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT CASE WHEN p_pos=1 THEN 'KIA' ELSE
 (ARRAY['HAN','SAM','LOT','LG','DOO','SSG','NC'])[1+((p_pos-2-(p_day%7)+700)%7)] END;
$function$;

-- rkbo_league_process
CREATE OR REPLACE FUNCTION public.rkbo_league_process(p_room uuid, p_force_timeout boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_room public.rkbo_league_rooms%rowtype;v_club text;v_ai boolean;v_slot text;
 v_candidates jsonb;v_card jsonb;v_right text;v_r int;v_t int;loops int:=0;
BEGIN
 LOOP
  loops:=loops+1;
  IF loops>200 THEN RAISE EXCEPTION '드래프트 자동 지명 횟수 초과';END IF;
  SELECT * INTO v_room FROM public.rkbo_league_rooms WHERE id=p_room FOR UPDATE;
  IF v_room.phase<>'draft' THEN RETURN;END IF;
  IF v_room.draft_round>18 THEN
   UPDATE public.rkbo_league_rooms
    SET phase='season',draft_candidates='[]',current_slot=NULL,current_club=NULL,expires_at=NULL,week=0,updated_at=now()
    WHERE id=p_room;
   RETURN;
  END IF;
  v_r:=v_room.draft_round;v_t:=v_room.draft_turn;
  SELECT owner_club INTO v_club FROM public.rkbo_league_rights WHERE room_id=p_room AND round=v_r AND pick=v_t;
  SELECT is_ai INTO v_ai FROM public.rkbo_league_members WHERE room_id=p_room AND club=v_club;
  v_slot:=public.rkbo_league_slot(v_r);
  IF v_club IS NULL THEN RAISE EXCEPTION '지명권 소유자를 찾을 수 없어';END IF;
  IF v_room.current_club=v_club AND v_room.current_slot=v_slot AND jsonb_array_length(v_room.draft_candidates)>0 THEN
   v_candidates:=v_room.draft_candidates;
   IF NOT v_ai AND (v_room.expires_at IS NULL OR v_room.expires_at>clock_timestamp()) THEN RETURN;END IF;
  ELSE
   v_candidates:=public.rkbo_league_candidates(p_room,v_slot);
  END IF;
  IF jsonb_array_length(v_candidates)=0 THEN
   -- Every candidate must be real; never synthesize players or repeat already drafted cards.
   RAISE EXCEPTION '해당 포지션 선수 풀이 부족해 드래프트를 계속할 수 없어: %',v_slot;
  END IF;
  IF NOT v_ai AND (v_room.current_club IS DISTINCT FROM v_club OR v_room.current_slot IS DISTINCT FROM v_slot) THEN
   UPDATE public.rkbo_league_rooms SET current_club=v_club,current_slot=v_slot,
     draft_candidates=v_candidates,expires_at=clock_timestamp()+interval '25 seconds',updated_at=now()
    WHERE id=p_room;
   RETURN;
  END IF;
  -- Auto choices favor good cards, with variance; expired humans auto-pick the top candidate.
  IF v_ai THEN
   SELECT e INTO v_card FROM jsonb_array_elements(v_candidates) e
     ORDER BY (e->>'ovr')::int+random()*12 DESC LIMIT 1;
  ELSE
   SELECT e INTO v_card FROM jsonb_array_elements(v_candidates) e
     ORDER BY (e->>'ovr')::int DESC LIMIT 1;
  END IF;
  INSERT INTO public.rkbo_league_picks(room_id,round,pick,club,slot,card_id,auto_selected)
   VALUES(p_room,v_r,v_t,v_club,v_slot,v_card->>'cardId',true);
  UPDATE public.rkbo_league_members
   SET roster=jsonb_set(roster,ARRAY[v_slot],v_card,true)
   WHERE room_id=p_room AND club=v_club;
  UPDATE public.rkbo_league_rooms SET draft_round=CASE WHEN v_t=8 THEN v_r+1 ELSE v_r END,
   draft_turn=CASE WHEN v_t=8 THEN 1 ELSE v_t+1 END,
   current_club=NULL,current_slot=NULL,draft_candidates='[]',expires_at=NULL,updated_at=now()
   WHERE id=p_room;
 END LOOP;
END;$function$;

-- rkbo_league_week
CREATE OR REPLACE FUNCTION public.rkbo_league_week(p_room uuid, p_action text DEFAULT 'next'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid:=auth.uid();r public.rkbo_league_rooms%rowtype;v_week int;
 v_day int;v_pair int;v_i int;v_no int;v_a text;v_h text;v_temp text;
 atk numeric;def numeric;edge numeric;roll numeric;x int;j int;score_a int;score_h int;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN
  RAISE EXCEPTION 'Google 로그인 후 이용해 줘' USING ERRCODE='28000';END IF;
 SELECT * INTO r FROM public.rkbo_league_rooms WHERE id=p_room FOR UPDATE;
 IF NOT FOUND OR r.host_id<>u THEN RAISE EXCEPTION '방장만 리그를 시뮬레이션할 수 있어' USING ERRCODE='42501';END IF;
 IF p_action='resume' THEN
  IF r.phase<>'midseason' THEN RAISE EXCEPTION '시즌 중반 트레이드 기간이 아니야';END IF;
  UPDATE public.rkbo_league_trades SET status='cancelled',resolved_at=now()
   WHERE room_id=p_room AND status='pending';
  UPDATE public.rkbo_league_rooms SET phase='season',updated_at=now() WHERE id=p_room;
  RETURN jsonb_build_object('phase','season','week',r.week);
 END IF;
 IF r.phase<>'season' THEN RAISE EXCEPTION '시뮬레이션 진행 상태가 아니야';END IF;
 IF r.week>=36 THEN RAISE EXCEPTION '144경기가 모두 끝났어';END IF;
 v_week:=r.week+1;
 FOR v_i IN 0..15 LOOP
  v_day:=r.week*4+(v_i/4);
  v_pair:=(v_i%4)+1;
  v_a:=public.rkbo_league_day_club(v_day,v_pair);
  v_h:=public.rkbo_league_day_club(v_day,9-v_pair);
  IF (v_day/7)%2=1 THEN v_temp:=v_a;v_a:=v_h;v_h:=v_temp;END IF;
  score_a:=0;score_h:=0;
  FOR j IN 1..9 LOOP
   atk:=public.rkbo_league_strength(p_room,v_a,'bat');
   def:=public.rkbo_league_strength(p_room,v_h,'pitch');
   edge:=greatest(-0.14,least(0.14,(atk-def)/110.0));
   roll:=greatest(0,least(0.999,random()+edge));
   score_a:=score_a+CASE WHEN roll<0.65 THEN 0 WHEN roll<0.90 THEN 1
    WHEN roll<0.98 THEN 2 ELSE 3 END;
   atk:=public.rkbo_league_strength(p_room,v_h,'bat');
   def:=public.rkbo_league_strength(p_room,v_a,'pitch');
   edge:=greatest(-0.14,least(0.14,(atk-def)/110.0));
   roll:=greatest(0,least(0.999,random()+edge));
   score_h:=score_h+CASE WHEN roll<0.65 THEN 0 WHEN roll<0.90 THEN 1
    WHEN roll<0.98 THEN 2 ELSE 3 END;
  END LOOP;
  -- Draws count as ties in the league table; games still run exactly nine innings.
  INSERT INTO public.rkbo_league_games(room_id,game_no,week,home_club,away_club,home_runs,away_runs)
   VALUES(p_room,r.week*16+v_i+1,v_week,v_h,v_a,score_h,score_a);
 END LOOP;
 UPDATE public.rkbo_league_rooms SET week=v_week,
  phase=CASE WHEN v_week=18 THEN 'midseason' WHEN v_week=36 THEN 'finished' ELSE 'season' END,
  updated_at=clock_timestamp() WHERE id=p_room;
 IF v_week=36 THEN
  PERFORM public.rkbo_league_finish_stats(p_room);
  UPDATE public.rkbo_league_rooms SET awards=public.rkbo_league_awards(p_room) WHERE id=p_room;
 END IF;
 RETURN jsonb_build_object('week',v_week,'games',16,'phase',
  CASE WHEN v_week=18 THEN 'midseason' WHEN v_week=36 THEN 'finished' ELSE 'season' END);
END;$function$;
