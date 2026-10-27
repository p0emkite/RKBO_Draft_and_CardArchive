-- Existing database upgrade. Combination functions only; no pack/data/RLS changes.
BEGIN;
CREATE OR REPLACE FUNCTION rkbo_private.combo_rates(p_points integer,p_season integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 grades text[]:=ARRAY['브론즈','실버','골드','코랄','다이아몬드','특수'];
 -- Each grade has explicit 3/4/5-card anchors. Interpolation preserves
 -- first-order stochastic dominance as total material points increase.
 bands integer[]:=ARRAY[3,4,5,9,12,15,21,28,35,45,60,75,90,120,150];
 weights numeric[][]:=ARRAY[
 ARRAY[65,27,6,1.5,0.4,0.1],
 ARRAY[55,32,9,3,0.8,0.2],
 ARRAY[45,36,14,3.5,1.2,0.3],
 ARRAY[30,50,15,3.5,1.2,0.3],
 ARRAY[20,50,23,5,1.4,0.6],
 ARRAY[10,50,30,7.5,1.8,0.7],
 ARRAY[0,30,55,12,2.2,0.8],
 ARRAY[0,20,58,18,3,1],
 ARRAY[0,10,60,25,3.8,1.2],
 ARRAY[0,0,30,60,8.5,1.5],
 ARRAY[0,0,20,64,14,2],
 ARRAY[0,0,10,68,19,3],
 ARRAY[0,0,0,30,67,3],
 ARRAY[0,0,0,20,74,6],
 ARRAY[0,0,0,10,80,10]
 ]::numeric[][];
 lo integer:=1; hi integer:=2; frac numeric; idx integer; target integer;
 available boolean[]; values_out numeric[]:=ARRAY[0,0,0,0,0,0]::numeric[];
 sum_weights numeric:=0; rounded_sum numeric:=0; last_positive integer; v jsonb:='{}'::jsonb;
BEGIN
 IF p_points IS NULL OR p_season IS NULL OR p_points<3 OR p_points>150 OR p_season<1 OR p_season>60 THEN
  RAISE EXCEPTION '조합 점수나 차수가 유효하지 않습니다' USING ERRCODE='22023';
 END IF;
 FOR idx IN 1..array_length(bands,1)-1 LOOP
  IF p_points<=bands[idx+1] THEN lo:=idx;hi:=idx+1;EXIT;END IF;
 END LOOP;
 frac:=(p_points-bands[lo])::numeric/(bands[hi]-bands[lo]);
 SELECT array_agg(EXISTS(SELECT 1 FROM public.rkbo_pack_cards c
   WHERE c.season=p_season AND c.grade=g.grade) ORDER BY g.ord)
 INTO available FROM unnest(grades[1:5]) WITH ORDINALITY g(grade,ord);
 available:=available||EXISTS(SELECT 1 FROM public.rkbo_pack_special_registry r
  JOIN public.rkbo_pack_cards c ON c.card_id=r.card_id
  WHERE r.active AND r.season=p_season AND c.season=p_season
   AND c.grade IN ('신인왕','드림','나눔','MVP','베스트릴리프'));
 IF NOT true=ANY(available) THEN
  RAISE EXCEPTION '이 시즌에는 조합 가능한 결과 카드가 없습니다' USING ERRCODE='22023';
 END IF;
 FOR idx IN 1..6 LOOP
  -- Missing grades fold down to the nearest available grade, or the
  -- lowest available grade if none is lower. Never renormalize away protection.
  target:=idx;
  WHILE target>0 AND NOT available[target] LOOP target:=target-1; END LOOP;
  IF target=0 THEN target:=array_position(available,true); END IF;
  values_out[target]:=values_out[target]+weights[lo][idx]*(1-frac)+weights[hi][idx]*frac;
 END LOOP;
 FOR idx IN 1..6 LOOP
  values_out[idx]:=round(values_out[idx],6);
  rounded_sum:=rounded_sum+values_out[idx];
  IF values_out[idx]>0 THEN last_positive:=idx; END IF;
 END LOOP;
 -- Exact 100% in millionths of a percent, shared by quote and draw.
 values_out[last_positive]:=values_out[last_positive]+100-rounded_sum;
 FOR idx IN 1..6 LOOP
  v:=v||jsonb_build_object(grades[idx],values_out[idx]);
 END LOOP;
 RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION rkbo_private.combo_rates(integer,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_combo_quote(p_card_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 quote jsonb; seasons integer[]; n integer; idx integer;
 grades text[]:=ARRAY['브론즈','실버','골드','코랄','다이아몬드','특수'];
 rates jsonb; total jsonb:='{}'::jsonb; g text; v numeric;
 rounded_sum numeric:=0; last_positive text;
BEGIN
 quote:=rkbo_private.combo_check(p_card_ids,false);
 IF quote->>'mode'='same' THEN
  seasons:=ARRAY[(quote->>'season')::integer];
 ELSE
  SELECT array_agg(season ORDER BY season) INTO seasons FROM
   (SELECT DISTINCT season FROM public.rkbo_pack_cards
    WHERE season BETWEEN 1 AND 60 AND grade IN
    ('브론즈','실버','골드','코랄','다이아몬드')) s;
 END IF;
 n:=coalesce(array_length(seasons,1),0);
 IF n=0 THEN RAISE EXCEPTION '조합할 수 있는 시즌이 등록되지 않았습니다' USING ERRCODE='22023'; END IF;
 FOREACH idx IN ARRAY seasons LOOP
  rates:=rkbo_private.combo_rates((quote->>'points')::integer,idx);
  FOREACH g IN ARRAY grades LOOP
   v:=coalesce((total->>g)::numeric,0)+coalesce((rates->>g)::numeric,0);
   total:=total||jsonb_build_object(g,v);
  END LOOP;
 END LOOP;
 FOREACH g IN ARRAY grades LOOP
  v:=round((total->>g)::numeric/n,6);
  total:=total||jsonb_build_object(g,v);rounded_sum:=rounded_sum+v;
  IF v>0 THEN last_positive:=g; END IF;
 END LOOP;
 total:=total||jsonb_build_object(last_positive,(total->>last_positive)::numeric+100-rounded_sum);
 RETURN quote||jsonb_build_object('odds',total,'eligibleSeasons',to_jsonb(seasons),
  'balanceVersion','combo-v2-20261027');
END;
$$;
REVOKE ALL ON FUNCTION public.rkbo_combo_quote(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_combo_quote(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_combine_cards(p_card_ids text[],p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u uuid:=auth.uid(); past jsonb; checked jsonb; quote jsonb;
 seasons integer[]; chosen_season integer; rate jsonb;
 labels text[]:=ARRAY['브론즈','실버','골드','코랄','다이아몬드','특수'];
 label text; chosen_grade text; roll numeric:=floor(random()*100000000)/1000000; cumulative numeric:=0;
 drawn public.rkbo_pack_cards%rowtype; material record;
 answer jsonb;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
    OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
   RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION '중복 처리 방지 요청 ID가 필요합니다' USING ERRCODE='22023'; END IF;
 -- One user-level serialization lock; duplicate requests return same result with no extra spend.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('rkbo-combo'),pg_catalog.hashtext(u::text));
 SELECT h.response INTO past FROM public.rkbo_combo_history h
 WHERE h.user_id=u AND h.request_id=p_request_id;
 IF FOUND THEN RETURN past||jsonb_build_object('replayed',true); END IF;
 checked:=rkbo_private.combo_check(p_card_ids,true);
 quote:=public.rkbo_combo_quote(p_card_ids);
 seasons:=ARRAY(SELECT jsonb_array_elements_text(quote->'eligibleSeasons')::integer);
 chosen_season:=seasons[1+floor(random()*array_length(seasons,1))::integer];
 rate:=rkbo_private.combo_rates((checked->>'points')::integer,chosen_season);
 FOREACH label IN ARRAY labels LOOP
  cumulative:=cumulative+coalesce((rate->>label)::numeric,0);
  IF roll<cumulative THEN chosen_grade:=label;EXIT;END IF;
 END LOOP;
 IF chosen_grade IS NULL THEN
  FOR material IN SELECT unnest(labels) AS g LOOP
   IF (rate->>material.g)::numeric>0 THEN chosen_grade:=material.g;END IF;
  END LOOP;
 END IF;
 IF chosen_grade IS NULL THEN RAISE EXCEPTION '조합 결과 등급을 결정할 수 없습니다' USING ERRCODE='22023'; END IF;
 IF chosen_grade='특수' THEN
  SELECT c.* INTO drawn FROM public.rkbo_pack_special_registry r
   JOIN public.rkbo_pack_cards c ON c.card_id=r.card_id
   WHERE r.season=chosen_season AND r.active AND c.season=chosen_season
    AND c.grade IN ('신인왕','드림','나눔','MVP','베스트릴리프')
   ORDER BY random() LIMIT 1;
 ELSE
  SELECT * INTO drawn FROM public.rkbo_pack_cards
   WHERE season=chosen_season AND grade=chosen_grade
   ORDER BY random() LIMIT 1;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION '조합 결과 카드 데이터가 존재하지 않습니다' USING ERRCODE='22023'; END IF;
 FOR material IN SELECT x.card_id,COUNT(*)::integer AS spent FROM unnest(p_card_ids) x(card_id)
    GROUP BY x.card_id ORDER BY x.card_id LOOP
  UPDATE public.rkbo_card_inventory SET quantity=quantity-material.spent
   WHERE user_id=u AND card_id=material.card_id AND quantity-material.spent>=1;
  IF NOT FOUND THEN RAISE EXCEPTION '조합 재료 수량이 변경되었습니다. 다시 선택해 주세요' USING ERRCODE='40001'; END IF;
 END LOOP;
 INSERT INTO public.rkbo_card_inventory(user_id,card_id,quantity,first_acquired_at,last_acquired_at,gold_border,prism)
 VALUES(u,drawn.card_id,1,now(),now(),false,false)
 ON CONFLICT(user_id,card_id) DO UPDATE
 SET quantity=public.rkbo_card_inventory.quantity+1,last_acquired_at=now();
 answer:=jsonb_build_object('result',jsonb_build_object('cardId',drawn.card_id,
  'season',drawn.season,'grade',drawn.grade,'name',drawn.name,'ovr',drawn.ovr,'team',drawn.team),
  'points',checked->'points','mode',checked->'mode','materials',checked->'materials',
  'odds',quote->'odds','seasonOdds',rate,'balanceVersion',quote->'balanceVersion',
  'season',chosen_season,'replayed',false);
 INSERT INTO public.rkbo_combo_history(user_id,request_id,ingredients,points,season_mode,
   result_season,result_card_id,result_grade,response)
 VALUES(u,p_request_id,checked->'materials',(checked->>'points')::integer,checked->>'mode',
    chosen_season,drawn.card_id,drawn.grade,answer);
 RETURN answer;
END;
$$;
REVOKE ALL ON FUNCTION public.rkbo_combine_cards(text[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_combine_cards(text[],uuid) TO authenticated;
COMMIT;
