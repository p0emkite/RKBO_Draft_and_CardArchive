-- Integration tests. Run as the database owner, in one call. All fixture data rolls back.
BEGIN;
DO $$
DECLARE
 u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); request_id uuid;
 ids text[]; recipe text[]; g text; n integer; s integer; item record;
 quote jsonb; answer jsonb; replay jsonb; expected jsonb; rates jsonb;
 total_before bigint; total_after bigint; history_before bigint; history_after bigint;
 sum_odds numeric; v numeric; expected_count integer:=0;
 labels text[]:=ARRAY['브론즈','실버','골드','코랄','다이아몬드','특수'];
BEGIN
 -- Temporary auth fixtures never survive this transaction.
 INSERT INTO auth.users(id,aud,role) VALUES(u,'authenticated','authenticated'),(other_user,'authenticated','authenticated');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','is_anonymous',false)::text,true);
 FOR s IN SELECT unnest(ARRAY[1,59,60]) LOOP
  FOR item IN SELECT grade,min(card_id) AS card_id FROM public.rkbo_pack_cards
   WHERE season=s AND grade=ANY(labels[1:5]) GROUP BY grade LOOP
   INSERT INTO public.rkbo_card_inventory(user_id,card_id,quantity) VALUES(u,item.card_id,10000);
  END LOOP;
 END LOOP;
 -- Actual quote + draw for every homogeneous 3/4/5 recipe in three pool configurations.
 FOR item IN SELECT i.card_id,c.season,c.grade FROM public.rkbo_card_inventory i
  JOIN public.rkbo_pack_cards c USING(card_id) WHERE i.user_id=u ORDER BY c.season,c.grade LOOP
  FOR n IN 3..5 LOOP
   recipe:=array_fill(item.card_id,ARRAY[n]);request_id:=gen_random_uuid();
   EXECUTE 'SET LOCAL ROLE authenticated';
   quote:=public.rkbo_combo_quote(recipe);
   EXECUTE 'RESET ROLE';
   IF quote->>'mode'<>'same' OR (quote->>'season')::integer<>item.season
     OR jsonb_array_length(quote->'eligibleSeasons')<>1 THEN RAISE EXCEPTION 'same-season quote failed'; END IF;
   IF quote->>'balanceVersion'<>'combo-v2-20261027' THEN RAISE EXCEPTION 'balance version mismatch'; END IF;
   rates:=rkbo_private.combo_rates((quote->>'points')::integer,item.season);
   IF quote->'odds'<>rates THEN RAISE EXCEPTION 'same-season quote/rates mismatch'; END IF;
   SELECT sum(quantity) INTO total_before FROM public.rkbo_card_inventory WHERE user_id=u;
   SELECT count(*) INTO history_before FROM public.rkbo_combo_history WHERE user_id=u;
   EXECUTE 'SET LOCAL ROLE authenticated';
   answer:=public.rkbo_combine_cards(recipe,request_id);
   replay:=public.rkbo_combine_cards(recipe,request_id);
   EXECUTE 'RESET ROLE';
   IF answer->'odds'<>quote->'odds' OR answer->'seasonOdds'<>rates
      OR answer->>'balanceVersion'<>quote->>'balanceVersion' THEN RAISE EXCEPTION 'quote/draw mismatch'; END IF;
   IF (answer->'result'->>'season')::integer<>item.season THEN RAISE EXCEPTION 'same-season result failed'; END IF;
   g:=answer->'result'->>'grade';IF NOT g=ANY(labels) THEN g:='특수';END IF;
   IF (rates->>g)::numeric<=0 THEN RAISE EXCEPTION 'zero-probability result'; END IF;
   IF replay->>'replayed'<>'true' OR replay->'result'<>answer->'result' THEN RAISE EXCEPTION 'idempotency failed'; END IF;
   SELECT sum(quantity) INTO total_after FROM public.rkbo_card_inventory WHERE user_id=u;
   SELECT count(*) INTO history_after FROM public.rkbo_combo_history WHERE user_id=u;
   IF total_after<>total_before-n+1 OR history_after<>history_before+1 THEN RAISE EXCEPTION 'atomic spend/grant failed'; END IF;
   expected_count:=expected_count+1;
  END LOOP;
 END LOOP;
 IF expected_count<>42 THEN RAISE EXCEPTION 'unexpected fixture coverage: %',expected_count; END IF;
 -- Mixed seasons: quote is the uniform average of all 60 actual season distributions.
 SELECT array_agg(card_id ORDER BY season) INTO ids FROM (
  SELECT DISTINCT ON(c.season)c.card_id,c.season FROM public.rkbo_card_inventory i
   JOIN public.rkbo_pack_cards c USING(card_id) WHERE i.user_id=u AND i.quantity>10 AND c.grade='코랄' ORDER BY c.season,c.card_id
 )q;
 EXECUTE 'SET LOCAL ROLE authenticated';
 quote:=public.rkbo_combo_quote(ids);
 EXECUTE 'RESET ROLE';
 IF quote->>'mode'<>'mixed' OR jsonb_array_length(quote->'eligibleSeasons')<>60 THEN RAISE EXCEPTION 'mixed-season pool failed'; END IF;
 expected:='{}';sum_odds:=0;
 FOREACH g IN ARRAY labels LOOP
  SELECT round(avg((rkbo_private.combo_rates((quote->>'points')::integer,x)->>g)::numeric),6)
   INTO v FROM generate_series(1,60)x;
  expected:=expected||jsonb_build_object(g,v);sum_odds:=sum_odds+v;
 END LOOP;
 -- This fixture's probabilities are exactly divisible at six decimal places.
 IF sum_odds<>100 OR quote->'odds'<>expected THEN RAISE EXCEPTION 'mixed marginal probabilities failed'; END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 answer:=public.rkbo_combine_cards(ids,gen_random_uuid());
 EXECUTE 'RESET ROLE';
 IF answer->'odds'<>quote->'odds' OR answer->'seasonOdds'<>rkbo_private.combo_rates((quote->>'points')::integer,(answer->>'season')::integer)
 THEN RAISE EXCEPTION 'mixed quote/draw mismatch'; END IF;
 -- Length bounds, null IDs, nonexistent IDs, insufficient copies.
 FOR n IN 0..6 LOOP
  IF n BETWEEN 3 AND 5 THEN CONTINUE;END IF;
  BEGIN
   PERFORM public.rkbo_combo_quote(array_fill(ids[1],ARRAY[n]));
   RAISE EXCEPTION 'accepted invalid material count %',n;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
 BEGIN PERFORM public.rkbo_combo_quote(ARRAY[ids[1],ids[1],NULL]);RAISE EXCEPTION 'accepted null ID';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM public.rkbo_combo_quote(ARRAY['not-owned','not-owned','not-owned']);RAISE EXCEPTION 'accepted unowned ID';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 UPDATE public.rkbo_card_inventory SET quantity=3 WHERE user_id=u AND card_id=ids[1];
 BEGIN PERFORM public.rkbo_combine_cards(array_fill(ids[1],ARRAY[3]),gen_random_uuid());RAISE EXCEPTION 'spent last copy';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 UPDATE public.rkbo_card_inventory SET quantity=100,gold_border=true WHERE user_id=u AND card_id=ids[1];
 BEGIN PERFORM public.rkbo_combo_quote(array_fill(ids[1],ARRAY[3]));RAISE EXCEPTION 'spent gold-border card';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 UPDATE public.rkbo_card_inventory SET gold_border=false,prism=true WHERE user_id=u AND card_id=ids[1];
 BEGIN PERFORM public.rkbo_combo_quote(array_fill(ids[1],ARRAY[3]));RAISE EXCEPTION 'spent prism card';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 UPDATE public.rkbo_card_inventory SET prism=false WHERE user_id=u AND card_id=ids[1];
 -- Protected inventory is absent from the actual inventory RPC.
 UPDATE public.rkbo_card_inventory SET gold_border=true WHERE user_id=u AND card_id=ids[1];
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.rkbo_combo_inventory() WHERE card_id=ids[1]) THEN RAISE EXCEPTION 'protected card visible';END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.rkbo_card_inventory SET gold_border=false WHERE user_id=u AND card_id=ids[1];
 INSERT INTO public.rkbo_owned_teams(user_id,name,slots,lineup,average_ovr,tpi)
 VALUES(u,'combo regression',(SELECT jsonb_agg(jsonb_build_object('cardId',ids[1])) FROM generate_series(1,18)),'{}',80,800);
 BEGIN PERFORM public.rkbo_combo_quote(array_fill(ids[1],ARRAY[3]));RAISE EXCEPTION 'spent roster card';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 SELECT card_id INTO g FROM public.rkbo_pack_cards WHERE grade IN ('신인왕','드림','나눔','MVP','베스트릴리프') LIMIT 1;
 INSERT INTO public.rkbo_card_inventory(user_id,card_id,quantity) VALUES(u,g,100) ON CONFLICT(user_id,card_id) DO UPDATE SET quantity=100;
 BEGIN PERFORM public.rkbo_combo_quote(array_fill(g,ARRAY[3]));RAISE EXCEPTION 'spent special card';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 -- Actual role permissions + ownership isolation.
 IF has_function_privilege('anon','public.rkbo_combo_quote(text[])','EXECUTE')
 OR has_function_privilege('anon','public.rkbo_combine_cards(text[],uuid)','EXECUTE')
 OR has_function_privilege('authenticated','rkbo_private.combo_rates(integer,integer)','EXECUTE')
 OR has_table_privilege('authenticated','public.rkbo_card_inventory','UPDATE')
 OR has_table_privilege('authenticated','public.rkbo_combo_history','INSERT') THEN RAISE EXCEPTION 'privilege regression'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.rkbo_card_inventory WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.rkbo_combo_history WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.rkbo_owned_teams WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.rkbo_combo_inventory()) THEN RAISE EXCEPTION 'cross-user RLS leak';END IF;
 EXECUTE 'RESET ROLE';
 BEGIN PERFORM public.rkbo_combo_quote(ids);RAISE EXCEPTION 'accepted other users materials';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN PERFORM public.rkbo_combo_quote(ids);RAISE EXCEPTION 'accepted unauthenticated quote';
 EXCEPTION WHEN SQLSTATE '28000' THEN NULL;END;
 BEGIN PERFORM public.rkbo_combine_cards(ids,gen_random_uuid());RAISE EXCEPTION 'accepted unauthenticated combine';
 EXCEPTION WHEN SQLSTATE '28000' THEN NULL;END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','is_anonymous',true)::text,true);
 BEGIN PERFORM public.rkbo_combo_quote(ids);RAISE EXCEPTION 'accepted anonymous-auth quote';
 EXCEPTION WHEN SQLSTATE '28000' THEN NULL;END;
END;
$$;
ROLLBACK;
SELECT jsonb_build_object('status','PASS','homogeneous_rpc_recipes',42,'mixed_rpc_recipes',1,
 'idempotent_replays',42,'inventory_protections',true,'rls_and_auth',true,'fixtures_rolled_back',true) AS integration_checks;
