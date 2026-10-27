-- Prevent unrelated room members from confirming an AI trade for another player.
CREATE OR REPLACE FUNCTION public.rkbo_league_trade(p_action text, p_room uuid, p_target text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text, p_offer uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid:=auth.uid();r public.rkbo_league_rooms%rowtype;
 t public.rkbo_league_trades%rowtype;owner_club text;target_club text;
 from_member public.rkbo_league_members%rowtype;to_member public.rkbo_league_members%rowtype;
 from_card jsonb;to_card jsonb;from_pick integer;to_pick integer;next_round integer;target_ai boolean;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
  OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요해' USING ERRCODE='28000';
 END IF;
 SELECT * INTO r FROM public.rkbo_league_rooms WHERE id=p_room FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '방을 찾을 수 없어';END IF;
 SELECT club INTO owner_club FROM public.rkbo_league_members WHERE room_id=p_room AND user_id=u;
 IF owner_club IS NULL THEN RAISE EXCEPTION '방 참가자가 아니야' USING ERRCODE='42501';END IF;
 IF p_action='create' THEN
  IF p_target IS NULL OR p_target=owner_club THEN RAISE EXCEPTION '상대 구단을 선택해 줘';END IF;
  SELECT * INTO to_member FROM public.rkbo_league_members WHERE room_id=p_room AND club=p_target;
  IF NOT FOUND THEN RAISE EXCEPTION '없는 구단이야';END IF;
  IF p_type='pick' THEN
   IF r.phase<>'draft' OR r.draft_round>=18 THEN RAISE EXCEPTION '다음 라운드 지명권 교환 기간이 아니야';END IF;
   p_from:='next';p_to:='next';
  ELSIF p_type='player' THEN
   IF r.phase<>'midseason' OR r.week<>18 THEN RAISE EXCEPTION '시즌 72경기가 끝난 중반 트레이드 기간에만 가능해';END IF;
   IF p_from IS NULL OR p_to IS NULL OR p_from<>p_to THEN
    RAISE EXCEPTION '같은 포지션 슬롯의 선수끼리 교환할 수 있어';END IF;
   SELECT * INTO from_member FROM public.rkbo_league_members WHERE room_id=p_room AND club=owner_club;
   IF NOT (from_member.roster ? p_from) OR NOT (to_member.roster ? p_to) THEN
    RAISE EXCEPTION '두 구단 모두 해당 포지션 선수가 있어야 해';END IF;
  ELSE RAISE EXCEPTION '지명권 또는 선수 교환을 선택해 줘';END IF;
  INSERT INTO public.rkbo_league_trades(room_id,proposer,recipient,trade_type,from_ref,to_ref)
   VALUES(p_room,owner_club,p_target,p_type,p_from,p_to) RETURNING * INTO t;
  IF to_member.is_ai THEN
   -- AI evaluates value fairly: equal positions and overall difference <= 10.
   IF p_type='player' THEN
    SELECT * INTO from_member FROM public.rkbo_league_members WHERE room_id=p_room AND club=owner_club;
    from_card:=from_member.roster->p_from;to_card:=to_member.roster->p_to;
    IF abs(coalesce((from_card->>'ovr')::int,0)-coalesce((to_card->>'ovr')::int,0))>10 THEN
     UPDATE public.rkbo_league_trades SET status='declined',resolved_at=now() WHERE id=t.id;
     RETURN jsonb_build_object('id',t.id,'status','declined','reason','AI 구단이 전력 차이를 이유로 거절했어');
    END IF;
   END IF;
   p_action:='accept_ai';p_offer:=t.id;
  ELSE
   RETURN jsonb_build_object('id',t.id,'status','pending');
  END IF;
 END IF;
 IF p_offer IS NULL THEN RAISE EXCEPTION '교환 요청을 선택해 줘';END IF;
 SELECT * INTO t FROM public.rkbo_league_trades WHERE id=p_offer AND room_id=p_room FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '교환 요청을 찾지 못했어';END IF;
 IF t.status<>'pending' THEN RETURN jsonb_build_object('id',t.id,'status',t.status,'replayed',true);END IF;
 IF p_action='cancel' AND t.proposer=owner_club OR p_action='decline' AND t.recipient=owner_club THEN
  UPDATE public.rkbo_league_trades SET status=CASE WHEN p_action='cancel' THEN 'cancelled' ELSE 'declined' END,
   resolved_at=now() WHERE id=t.id RETURNING * INTO t;
  RETURN jsonb_build_object('id',t.id,'status',t.status);
 END IF;
 IF p_action<>'accept_ai' AND (p_action<>'accept' OR t.recipient<>owner_club) THEN
  RAISE EXCEPTION '교환 수락 권한이 없어' USING ERRCODE='42501';
 END IF;
 IF p_action='accept_ai' AND (t.proposer<>owner_club OR NOT EXISTS(SELECT 1 FROM public.rkbo_league_members
   WHERE room_id=p_room AND club=t.recipient AND is_ai)) THEN
  RAISE EXCEPTION 'AI 구단에 대한 교환이 아니야';
 END IF;
 IF t.trade_type='pick' THEN
  IF r.phase<>'draft' OR r.draft_round>=18 THEN RAISE EXCEPTION '지명권 교환이 마감됐어';END IF;
  next_round:=r.draft_round+1;
  SELECT pick INTO from_pick FROM public.rkbo_league_rights
   WHERE room_id=p_room AND round=next_round AND owner_club=t.proposer;
  SELECT pick INTO to_pick FROM public.rkbo_league_rights
   WHERE room_id=p_room AND round=next_round AND owner_club=t.recipient;
  IF from_pick IS NULL OR to_pick IS NULL THEN RAISE EXCEPTION '지명권을 찾지 못했어';END IF;
  UPDATE public.rkbo_league_rights SET owner_club=CASE
   WHEN pick=from_pick THEN t.recipient WHEN pick=to_pick THEN t.proposer ELSE owner_club END
   WHERE room_id=p_room AND round=next_round AND pick IN(from_pick,to_pick);
 ELSE
  IF r.phase<>'midseason' OR r.week<>18 THEN RAISE EXCEPTION '트레이드 기간이 종료됐어';END IF;
  SELECT * INTO from_member FROM public.rkbo_league_members
   WHERE room_id=p_room AND club=t.proposer FOR UPDATE;
  SELECT * INTO to_member FROM public.rkbo_league_members
   WHERE room_id=p_room AND club=t.recipient FOR UPDATE;
  IF t.from_ref<>t.to_ref OR NOT (from_member.roster ? t.from_ref) OR
   NOT (to_member.roster ? t.to_ref) THEN
   RAISE EXCEPTION '선수 구성 변경으로 해당 트레이드를 진행할 수 없어';
  END IF;
  from_card:=from_member.roster->t.from_ref;to_card:=to_member.roster->t.to_ref;
  UPDATE public.rkbo_league_members
   SET roster=jsonb_set(roster,ARRAY[t.from_ref],to_card,true)
   WHERE room_id=p_room AND club=t.proposer;
  UPDATE public.rkbo_league_members
   SET roster=jsonb_set(roster,ARRAY[t.to_ref],from_card,true)
   WHERE room_id=p_room AND club=t.recipient;
 END IF;
 UPDATE public.rkbo_league_trades SET status='accepted',resolved_at=now() WHERE id=t.id;
 UPDATE public.rkbo_league_rooms SET updated_at=clock_timestamp() WHERE id=p_room;
 RETURN jsonb_build_object('id',t.id,'status','accepted','type',t.trade_type);
END;$function$;
