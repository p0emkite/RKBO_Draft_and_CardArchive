-- RKBO community v1: private-by-default card browsing, atomic swaps, live chat.
-- Existing packs, card odds, 50-pack pity, teams and matches remain unchanged.

CREATE TABLE IF NOT EXISTS public.rkbo_community_visibility (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 is_public boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rkbo_community_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_visibility FROM anon, authenticated;
GRANT SELECT ON public.rkbo_community_visibility TO authenticated;
DROP POLICY IF EXISTS rkbo_visibility_self ON public.rkbo_community_visibility;
CREATE POLICY rkbo_visibility_self ON public.rkbo_community_visibility FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.rkbo_community_trades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 offered_card_id text NOT NULL REFERENCES public.rkbo_pack_cards(card_id),
 requested_card_id text NOT NULL REFERENCES public.rkbo_pack_cards(card_id),
 status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','accepted','declined','cancelled')),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CONSTRAINT rkbo_trade_not_self CHECK (sender_id<>receiver_id),
 CONSTRAINT rkbo_trade_not_same CHECK (offered_card_id<>requested_card_id),
 CONSTRAINT rkbo_trade_unique_request UNIQUE(sender_id,request_id)
);
CREATE INDEX IF NOT EXISTS rkbo_trade_sender_idx ON public.rkbo_community_trades(sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS rkbo_trade_receiver_idx ON public.rkbo_community_trades(receiver_id,created_at DESC);
ALTER TABLE public.rkbo_community_trades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_trades FROM anon,authenticated;
GRANT SELECT ON public.rkbo_community_trades TO authenticated;
DROP POLICY IF EXISTS rkbo_trade_parties ON public.rkbo_community_trades;
CREATE POLICY rkbo_trade_parties ON public.rkbo_community_trades FOR SELECT TO authenticated
 USING (sender_id=(SELECT auth.uid()) OR receiver_id=(SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.rkbo_community_chat_messages(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 240),
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS rkbo_chat_new_idx ON public.rkbo_community_chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS rkbo_chat_user_idx ON public.rkbo_community_chat_messages(user_id,created_at DESC);
ALTER TABLE public.rkbo_community_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_chat_messages FROM anon,authenticated;
GRANT SELECT ON public.rkbo_community_chat_messages TO authenticated;
DROP POLICY IF EXISTS rkbo_chat_logged_in_read ON public.rkbo_community_chat_messages;
CREATE POLICY rkbo_chat_logged_in_read ON public.rkbo_community_chat_messages FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IS NOT NULL AND
  coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);

CREATE TABLE IF NOT EXISTS public.rkbo_community_chat_reports(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 message_id bigint NOT NULL REFERENCES public.rkbo_community_chat_messages(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(message_id,reporter_id)
);
ALTER TABLE public.rkbo_community_chat_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_chat_reports FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_set_public(p_public boolean)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
  OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 INSERT INTO public.rkbo_community_visibility(user_id,is_public,updated_at)
 VALUES(u,coalesce(p_public,false),now())
 ON CONFLICT(user_id) DO UPDATE SET is_public=excluded.is_public,updated_at=now();
 RETURN coalesce(p_public,false);
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_set_public(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_set_public(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_members(p_search text DEFAULT '')
 RETURNS TABLE(user_id uuid,nickname text,is_public boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
  OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 RETURN QUERY SELECT p.user_id,p.nickname,coalesce(s.is_public,false)
 FROM public.rkbo_profiles p LEFT JOIN public.rkbo_community_visibility s ON s.user_id=p.user_id
 WHERE p.nickname ILIKE '%'||left(trim(coalesce(p_search,'')),50)||'%'
 ORDER BY lower(p.nickname),p.user_id LIMIT 40;
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_members(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_members(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_collection(
 p_user uuid,p_search text DEFAULT '',p_limit integer DEFAULT 80,p_offset integer DEFAULT 0)
 RETURNS TABLE(card_id text,season integer,grade text,name text,ovr integer,
  quantity integer,tradable boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
  OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF p_user IS NULL THEN RETURN;END IF;
 IF p_user<>auth.uid() AND NOT EXISTS (
  SELECT 1 FROM public.rkbo_community_visibility s
  WHERE s.user_id=p_user AND s.is_public=true) THEN
  RETURN;
 END IF;
 RETURN QUERY
 SELECT c.card_id,c.season,c.grade,c.name,c.ovr,i.quantity,
  (i.quantity>=2 AND NOT i.gold_border AND NOT i.prism
   AND NOT EXISTS(SELECT 1 FROM public.rkbo_owned_teams t
    WHERE t.user_id=p_user AND EXISTS(
     SELECT 1 FROM jsonb_array_elements(t.slots) slot WHERE slot->>'cardId'=i.card_id)))
 FROM public.rkbo_card_inventory i
 JOIN public.rkbo_pack_cards c ON c.card_id=i.card_id
 WHERE i.user_id=p_user AND i.quantity>0
  AND (coalesce(p_search,'')='' OR
    c.name ILIKE '%'||left(trim(p_search),60)||'%' OR
    c.card_id ILIKE '%'||left(trim(p_search),60)||'%')
 ORDER BY c.season DESC,c.ovr DESC,c.card_id
 LIMIT least(greatest(coalesce(p_limit,80),1),100)
 OFFSET least(greatest(coalesce(p_offset,0),0),10000);
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_collection(uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_collection(uuid,text,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_trade(
 p_action text,p_target uuid DEFAULT NULL,p_offered text DEFAULT NULL,
 p_requested text DEFAULT NULL,p_trade uuid DEFAULT NULL,p_request uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u uuid:=auth.uid();t public.rkbo_community_trades%rowtype;
 i1 public.rkbo_card_inventory%rowtype;i2 public.rkbo_card_inventory%rowtype;
 sender uuid;receiver uuid;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
  OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF p_action='create' THEN
  IF p_target IS NULL OR p_target=u OR p_offered IS NULL OR p_requested IS NULL
   OR p_offered=p_requested OR p_request IS NULL THEN
   RAISE EXCEPTION '교환 대상·선수 카드·요청 ID를 확인해 주세요' USING ERRCODE='22023';
  END IF;
  SELECT * INTO t FROM public.rkbo_community_trades
   WHERE sender_id=u AND request_id=p_request;
  IF FOUND THEN RETURN jsonb_build_object('id',t.id,'status',t.status,'replayed',true);END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rkbo_community_visibility
    WHERE user_id=u AND is_public)
    OR NOT EXISTS (SELECT 1 FROM public.rkbo_community_visibility
    WHERE user_id=p_target AND is_public) THEN
   RAISE EXCEPTION '교환하려면 양쪽 회원 모두 도감을 공개해야 합니다' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rkbo_card_inventory i WHERE i.user_id=u AND i.card_id=p_offered
     AND i.quantity>=2 AND NOT i.gold_border AND NOT i.prism
     AND NOT EXISTS(SELECT 1 FROM public.rkbo_owned_teams team
      WHERE team.user_id=u AND EXISTS(SELECT 1 FROM jsonb_array_elements(team.slots) slot
       WHERE slot->>'cardId'=p_offered)))
    OR NOT EXISTS(SELECT 1 FROM public.rkbo_card_inventory i WHERE i.user_id=p_target AND i.card_id=p_requested
     AND i.quantity>=2 AND NOT i.gold_border AND NOT i.prism
     AND NOT EXISTS(SELECT 1 FROM public.rkbo_owned_teams team
      WHERE team.user_id=p_target AND EXISTS(SELECT 1 FROM jsonb_array_elements(team.slots) slot
       WHERE slot->>'cardId'=p_requested))) THEN
   RAISE EXCEPTION '교환 가능한 중복 카드가 양쪽에 필요합니다' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.rkbo_community_trades(sender_id,receiver_id,offered_card_id,requested_card_id,request_id)
   VALUES(u,p_target,p_offered,p_requested,p_request)
   ON CONFLICT(sender_id,request_id) DO NOTHING
   RETURNING * INTO t;
  IF NOT FOUND THEN
   SELECT * INTO t FROM public.rkbo_community_trades WHERE sender_id=u AND request_id=p_request;
  END IF;
  RETURN jsonb_build_object('id',t.id,'status',t.status,'replayed',false);
 END IF;
 IF p_trade IS NULL THEN RAISE EXCEPTION '교환 요청이 없습니다' USING ERRCODE='22023';END IF;
 SELECT * INTO t FROM public.rkbo_community_trades WHERE id=p_trade FOR UPDATE;
 IF NOT FOUND OR (u<>t.sender_id AND u<>t.receiver_id) THEN
  RAISE EXCEPTION '내 교환 요청이 아닙니다' USING ERRCODE='42501';
 END IF;
 IF t.status<>'pending' THEN
  RETURN jsonb_build_object('id',t.id,'status',t.status,'replayed',true);
 END IF;
 IF p_action='cancel' AND u=t.sender_id OR p_action='decline' AND u=t.receiver_id THEN
  UPDATE public.rkbo_community_trades SET status=CASE WHEN p_action='cancel' THEN 'cancelled' ELSE 'declined' END,
    completed_at=now() WHERE id=t.id RETURNING * INTO t;
  RETURN jsonb_build_object('id',t.id,'status',t.status);
 END IF;
 IF p_action<>'accept' OR u<>t.receiver_id THEN
  RAISE EXCEPTION '수락·거절 권한이 없습니다' USING ERRCODE='42501';
 END IF;
 sender:=t.sender_id;receiver:=t.receiver_id;
 -- Serializes multi-user transfers regardless of who initiates them.
 PERFORM pg_advisory_xact_lock(hashtextextended('rkbo-trade:'||least(sender::text,receiver::text),0));
 PERFORM pg_advisory_xact_lock(hashtextextended('rkbo-trade:'||greatest(sender::text,receiver::text),0));
 SELECT * INTO i1 FROM public.rkbo_card_inventory
  WHERE user_id=sender AND card_id=t.offered_card_id FOR UPDATE;
 SELECT * INTO i2 FROM public.rkbo_card_inventory
  WHERE user_id=receiver AND card_id=t.requested_card_id FOR UPDATE;
 IF i1.user_id IS NULL OR i2.user_id IS NULL OR
  i1.quantity<2 OR i2.quantity<2 OR i1.gold_border OR i1.prism OR i2.gold_border OR i2.prism OR
  EXISTS(SELECT 1 FROM public.rkbo_owned_teams team WHERE team.user_id=sender AND
   EXISTS(SELECT 1 FROM jsonb_array_elements(team.slots) slot WHERE slot->>'cardId'=t.offered_card_id)) OR
  EXISTS(SELECT 1 FROM public.rkbo_owned_teams team WHERE team.user_id=receiver AND
   EXISTS(SELECT 1 FROM jsonb_array_elements(team.slots) slot WHERE slot->>'cardId'=t.requested_card_id)) THEN
  RAISE EXCEPTION '제안 이후 카드 보유 상태가 바뀌어 교환할 수 없습니다' USING ERRCODE='22023';
 END IF;
 UPDATE public.rkbo_card_inventory SET quantity=quantity-1,last_acquired_at=now()
  WHERE user_id=sender AND card_id=t.offered_card_id AND quantity>=2;
 IF NOT FOUND THEN RAISE EXCEPTION '보낸 카드 수량이 부족합니다' USING ERRCODE='40001';END IF;
 UPDATE public.rkbo_card_inventory SET quantity=quantity-1,last_acquired_at=now()
  WHERE user_id=receiver AND card_id=t.requested_card_id AND quantity>=2;
 IF NOT FOUND THEN RAISE EXCEPTION '받을 카드 수량이 부족합니다' USING ERRCODE='40001';END IF;
 INSERT INTO public.rkbo_card_inventory(user_id,card_id,quantity)
  VALUES(receiver,t.offered_card_id,1)
  ON CONFLICT(user_id,card_id) DO UPDATE
  SET quantity=public.rkbo_card_inventory.quantity+1,last_acquired_at=now();
 INSERT INTO public.rkbo_card_inventory(user_id,card_id,quantity)
  VALUES(sender,t.requested_card_id,1)
  ON CONFLICT(user_id,card_id) DO UPDATE
  SET quantity=public.rkbo_card_inventory.quantity+1,last_acquired_at=now();
 UPDATE public.rkbo_community_trades SET status='accepted',completed_at=now()
  WHERE id=t.id RETURNING * INTO t;
 RETURN jsonb_build_object('id',t.id,'status',t.status);
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_trade(text,uuid,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_trade(text,uuid,text,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_chat_send(p_body text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();msg text:=btrim(coalesce(p_body,''));result public.rkbo_community_chat_messages%rowtype;
BEGIN
 IF u IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
  OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF length(msg)<1 OR length(msg)>240 THEN RAISE EXCEPTION '메시지는 1~240자로 작성해 주세요' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rkbo-chat:'||u::text,0));
 IF EXISTS(SELECT 1 FROM public.rkbo_community_chat_messages
   WHERE user_id=u AND created_at>clock_timestamp()-interval '3 seconds') THEN
  RAISE EXCEPTION '채팅은 3초 간격으로 보낼 수 있습니다' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(*) FROM public.rkbo_community_chat_messages
   WHERE user_id=u AND created_at>clock_timestamp()-interval '10 minutes')>=30 THEN
  RAISE EXCEPTION '10분 메시지 한도(30개)에 도달했습니다' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.rkbo_community_chat_messages(user_id,body)
  VALUES(u,msg) RETURNING * INTO result;
 RETURN jsonb_build_object('id',result.id,'created_at',result.created_at);
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_chat_send(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_chat_send(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_chat_delete(p_id bigint)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 UPDATE public.rkbo_community_chat_messages SET body='[삭제된 메시지]',deleted=true
 WHERE id=p_id AND user_id=auth.uid() AND NOT deleted;
 RETURN FOUND;
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_chat_delete(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_chat_delete(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.rkbo_community_chat_report(p_id bigint)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated' THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rkbo_community_chat_messages
  WHERE id=p_id AND user_id<>auth.uid() AND NOT deleted) THEN
  RAISE EXCEPTION '신고할 수 없는 메시지입니다' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.rkbo_community_chat_reports(message_id,reporter_id)
  VALUES(p_id,auth.uid()) ON CONFLICT(message_id,reporter_id) DO NOTHING;
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_chat_report(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_chat_report(bigint) TO authenticated;

-- Add chat to Postgres Changes stream without disturbing existing publications.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND
 NOT EXISTS(SELECT 1 FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='rkbo_community_chat_messages') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rkbo_community_chat_messages;
 END IF;
END $$;
