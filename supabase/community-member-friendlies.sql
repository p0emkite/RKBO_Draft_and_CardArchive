-- RKBO peer friendlies v1. Asynchronous invites; server verifies both lineups
-- and simulates a nine-inning match using official batter/pitcher ratings.
CREATE TABLE IF NOT EXISTS public.rkbo_community_friendlies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 challenger_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 opponent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 challenger_team_id uuid NOT NULL,
 opponent_team_id uuid,
 challenger_team_name text NOT NULL,
 opponent_team_name text,
 challenger_slots jsonb NOT NULL CHECK(jsonb_typeof(challenger_slots)='array' AND jsonb_array_length(challenger_slots)=18),
 opponent_slots jsonb,
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','completed','declined','cancelled')),
 challenger_runs integer CHECK(challenger_runs BETWEEN 0 AND 99),
 opponent_runs integer CHECK(opponent_runs BETWEEN 0 AND 99),
 innings jsonb,
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE(challenger_id,request_id),
 CHECK(challenger_id<>opponent_id),
 CHECK(opponent_slots IS NULL OR (jsonb_typeof(opponent_slots)='array' AND jsonb_array_length(opponent_slots)=18))
);
CREATE INDEX IF NOT EXISTS rkbo_friendly_sender_recent ON public.rkbo_community_friendlies(challenger_id,created_at DESC);
CREATE INDEX IF NOT EXISTS rkbo_friendly_target_recent ON public.rkbo_community_friendlies(opponent_id,created_at DESC);
ALTER TABLE public.rkbo_community_friendlies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_friendlies FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rkbo_community_friendlies TO authenticated;
DROP POLICY IF EXISTS rkbo_friendly_participants ON public.rkbo_community_friendlies;
CREATE POLICY rkbo_friendly_participants ON public.rkbo_community_friendlies FOR SELECT TO authenticated
 USING((challenger_id=(SELECT auth.uid()) OR opponent_id=(SELECT auth.uid()))
 AND coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);

CREATE OR REPLACE FUNCTION public.rkbo_friendly_validate_lineup(p_owner uuid,p_slots jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(p_slots)='array' AND jsonb_array_length(p_slots)=18,false)
 AND (
  SELECT count(*)=18 AND count(DISTINCT v->>'slot')=18 AND count(DISTINCT v->>'cardId')=18
  FROM jsonb_array_elements(p_slots) v
  JOIN public.rkbo_card_inventory inv ON inv.user_id=p_owner
   AND inv.card_id=v->>'cardId' AND (inv.quantity>0 OR inv.gold_border OR inv.prism)
  JOIN public.rkbo_pack_cards p ON p.card_id=v->>'cardId'
 );
$$;
REVOKE ALL ON FUNCTION public.rkbo_friendly_validate_lineup(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_friendly_strength(p_slots jsonb)
RETURNS TABLE(offense numeric,pitching numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT
  coalesce((SELECT avg(
   (coalesce(nullif(pc.ratings->>'정확','')::numeric,pc.ovr)+
    coalesce(nullif(pc.ratings->>'파워','')::numeric,pc.ovr)+
    coalesce(nullif(pc.ratings->>'선구','')::numeric,pc.ovr))/3)
   FROM jsonb_array_elements(p_slots) el
   JOIN public.rkbo_pack_cards pc ON pc.card_id=el->>'cardId'
   WHERE el->>'slot' IN ('C','1B','2B','3B','SS','LF','CF','RF','DH')),70)::numeric,
  coalesce((SELECT avg(
   (coalesce(nullif(pc.ratings->>'구위','')::numeric,pc.ovr)+
    coalesce(nullif(pc.ratings->>'제구','')::numeric,pc.ovr)+
    coalesce(nullif(pc.ratings->>'피안타 억제','')::numeric,pc.ovr))/3)
   FROM jsonb_array_elements(p_slots) el
   JOIN public.rkbo_pack_cards pc ON pc.card_id=el->>'cardId'
   WHERE el->>'slot' IN ('SP1','SP2','SP3','SP4','SP5','RP1','RP2','RP3','CP')),70)::numeric;
$$;
REVOKE ALL ON FUNCTION public.rkbo_friendly_strength(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_friendly(
 p_action text,p_target uuid DEFAULT NULL,p_team uuid DEFAULT NULL,
 p_match uuid DEFAULT NULL,p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();m public.rkbo_community_friendlies%rowtype;
 t public.rkbo_owned_teams%rowtype;v_off_away numeric;v_pitch_away numeric;
 v_off_home numeric;v_pitch_home numeric;v_edge_away numeric;v_edge_home numeric;
 v_roll numeric;v_away int:=0;v_home int:=0;v_a int;v_h int;i int;v_innings jsonb:='[]'::jsonb;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
   OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF p_action='create' THEN
  IF p_target IS NULL OR p_target=u OR p_team IS NULL OR p_request IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.rkbo_profiles WHERE user_id=p_target) THEN
   RAISE EXCEPTION '친선경기 상대와 MY TEAM을 선택해 주세요' USING ERRCODE='22023';
  END IF;
  SELECT * INTO m FROM public.rkbo_community_friendlies
   WHERE challenger_id=u AND request_id=p_request;
  IF FOUND THEN RETURN jsonb_build_object('id',m.id,'status',m.status,'replayed',true);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rkbo-friendly:'||u::text,0));
  IF (SELECT count(*) FROM public.rkbo_community_friendlies
   WHERE challenger_id=u AND status='pending')>=12 THEN
   RAISE EXCEPTION '대기 중인 도전장이 12개야. 먼저 기존 도전장을 정리해 줘' USING ERRCODE='22023';
  END IF;
  SELECT * INTO t FROM public.rkbo_owned_teams WHERE id=p_team AND user_id=u;
  IF NOT FOUND OR NOT public.rkbo_friendly_validate_lineup(u,t.slots) THEN
   RAISE EXCEPTION '보유 선수 18명으로 완성된 내 MY TEAM을 선택해 줘' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.rkbo_community_friendlies(challenger_id,opponent_id,
   challenger_team_id,challenger_team_name,challenger_slots,request_id)
  VALUES(u,p_target,t.id,t.name,t.slots,p_request)
  ON CONFLICT(challenger_id,request_id) DO NOTHING RETURNING * INTO m;
  IF NOT FOUND THEN SELECT * INTO m FROM public.rkbo_community_friendlies
   WHERE challenger_id=u AND request_id=p_request;END IF;
  RETURN jsonb_build_object('id',m.id,'status',m.status);
 END IF;
 IF p_match IS NULL THEN RAISE EXCEPTION '친선경기 요청 ID가 필요해' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM public.rkbo_community_friendlies WHERE id=p_match FOR UPDATE;
 IF NOT FOUND OR u NOT IN (m.challenger_id,m.opponent_id) THEN
  RAISE EXCEPTION '참여할 수 없는 친선경기야' USING ERRCODE='42501';
 END IF;
 IF m.status<>'pending' THEN
  RETURN jsonb_build_object('id',m.id,'status',m.status,
   'challengerRuns',m.challenger_runs,'opponentRuns',m.opponent_runs,'innings',m.innings,'replayed',true);
 END IF;
 IF (p_action='cancel' AND u=m.challenger_id) OR
    (p_action='decline' AND u=m.opponent_id) THEN
  UPDATE public.rkbo_community_friendlies
   SET status=CASE WHEN p_action='cancel' THEN 'cancelled' ELSE 'declined' END,
       completed_at=now() WHERE id=m.id RETURNING * INTO m;
  RETURN jsonb_build_object('id',m.id,'status',m.status);
 END IF;
 IF p_action<>'accept' OR u<>m.opponent_id THEN
  RAISE EXCEPTION '수락하거나 취소할 권한이 없어' USING ERRCODE='42501';
 END IF;
 IF p_team IS NULL THEN RAISE EXCEPTION '수락할 때 사용할 MY TEAM을 선택해 줘' USING ERRCODE='22023';END IF;
 SELECT * INTO t FROM public.rkbo_owned_teams WHERE id=p_team AND user_id=u;
 IF NOT FOUND OR NOT public.rkbo_friendly_validate_lineup(u,t.slots) THEN
  RAISE EXCEPTION '완성된 MY TEAM을 선택해야 해' USING ERRCODE='22023';
 END IF;
 IF NOT public.rkbo_friendly_validate_lineup(m.challenger_id,m.challenger_slots) THEN
  RAISE EXCEPTION '상대의 선수단이 변경되어 경기를 진행할 수 없어' USING ERRCODE='22023';
 END IF;
 SELECT offense,pitching INTO v_off_away,v_pitch_away
  FROM public.rkbo_friendly_strength(m.challenger_slots);
 SELECT offense,pitching INTO v_off_home,v_pitch_home
  FROM public.rkbo_friendly_strength(t.slots);
 v_edge_away:=greatest(-0.15,least(0.15,(v_off_away-v_pitch_home)/110));
 v_edge_home:=greatest(-0.15,least(0.15,(v_off_home-v_pitch_away)/110));
 FOR i IN 1..9 LOOP
  v_roll:=greatest(0,least(0.999,random()+v_edge_away));
  v_a:=CASE WHEN v_roll<0.49 THEN 0 WHEN v_roll<0.78 THEN 1
   WHEN v_roll<0.92 THEN 2 WHEN v_roll<0.97 THEN 3 ELSE 4 END;
  v_roll:=greatest(0,least(0.999,random()+v_edge_home));
  v_h:=CASE WHEN v_roll<0.49 THEN 0 WHEN v_roll<0.78 THEN 1
   WHEN v_roll<0.92 THEN 2 WHEN v_roll<0.97 THEN 3 ELSE 4 END;
  v_away:=v_away+v_a;v_home:=v_home+v_h;
  v_innings:=v_innings||jsonb_build_array(jsonb_build_object('inning',i,'away',v_a,'home',v_h));
 END LOOP;
 UPDATE public.rkbo_community_friendlies
 SET status='completed',opponent_team_id=t.id,opponent_team_name=t.name,opponent_slots=t.slots,
     challenger_runs=v_away,opponent_runs=v_home,innings=v_innings,completed_at=clock_timestamp()
 WHERE id=m.id RETURNING * INTO m;
 RETURN jsonb_build_object('id',m.id,'status',m.status,'challengerRuns',m.challenger_runs,
  'opponentRuns',m.opponent_runs,'innings',m.innings);
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_friendly(text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_friendly(text,uuid,uuid,uuid,uuid) TO authenticated;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
   AND schemaname='public' AND tablename='rkbo_community_friendlies') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rkbo_community_friendlies;
 END IF;
END$$;
