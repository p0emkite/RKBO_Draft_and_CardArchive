-- RKBO community activity v1: server-attested elite pulls and private trade alerts.
CREATE TABLE IF NOT EXISTS public.rkbo_community_highlights (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 pack_history_id uuid NOT NULL REFERENCES public.rkbo_pack_history(id) ON DELETE CASCADE,
 draw_slot smallint NOT NULL CHECK(draw_slot BETWEEN 1 AND 5),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 nickname text NOT NULL CHECK(length(nickname) BETWEEN 2 AND 40),
 card_id text NOT NULL REFERENCES public.rkbo_pack_cards(card_id),
 card_name text NOT NULL,
 season integer NOT NULL,
 grade text NOT NULL CHECK(grade IN ('다이아몬드','신인왕','드림','나눔','MVP','베스트릴리프')),
 obtained_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(pack_history_id,draw_slot)
);
CREATE INDEX IF NOT EXISTS rkbo_highlight_recent_idx ON public.rkbo_community_highlights(obtained_at DESC);
ALTER TABLE public.rkbo_community_highlights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_highlights FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rkbo_community_highlights TO authenticated;
DROP POLICY IF EXISTS rkbo_highlights_member_read ON public.rkbo_community_highlights;
CREATE POLICY rkbo_highlights_member_read ON public.rkbo_community_highlights FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IS NOT NULL AND coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);

CREATE OR REPLACE FUNCTION public.rkbo_log_high_grade_open()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_item jsonb; v_idx int; v_grade text; v_card public.rkbo_pack_cards%rowtype; v_nick text;
BEGIN
 SELECT nickname INTO v_nick FROM public.rkbo_profiles WHERE user_id=NEW.user_id;
 IF v_nick IS NULL THEN RETURN NEW; END IF;
 FOR v_idx IN 0..4 LOOP
  v_item:=NEW.draws->v_idx;
  v_grade:=v_item->>'grade';
  IF v_grade IN ('다이아몬드','신인왕','드림','나눔','MVP','베스트릴리프') THEN
   SELECT * INTO v_card FROM public.rkbo_pack_cards WHERE card_id=v_item->>'cardId';
   IF v_card.card_id IS NOT NULL AND v_card.grade=v_grade AND v_card.season=NEW.season THEN
    INSERT INTO public.rkbo_community_highlights(
      pack_history_id,draw_slot,user_id,nickname,card_id,card_name,season,grade,obtained_at)
    VALUES(NEW.id,v_idx+1,NEW.user_id,v_nick,v_card.card_id,v_card.name,v_card.season,v_grade,NEW.opened_at)
    ON CONFLICT(pack_history_id,draw_slot) DO NOTHING;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_log_high_grade_open() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS rkbo_high_grade_open_insert ON public.rkbo_pack_history;
CREATE TRIGGER rkbo_high_grade_open_insert AFTER INSERT ON public.rkbo_pack_history
 FOR EACH ROW EXECUTE FUNCTION public.rkbo_log_high_grade_open();

CREATE TABLE IF NOT EXISTS public.rkbo_community_alerts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 trade_id uuid NOT NULL REFERENCES public.rkbo_community_trades(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('trade_offer','trade_accepted','trade_declined','trade_cancelled')),
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 actor_nickname text NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 300),
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 UNIQUE(recipient_id,trade_id,kind)
);
CREATE INDEX IF NOT EXISTS rkbo_community_alert_recipient_idx ON public.rkbo_community_alerts(recipient_id,created_at DESC);
ALTER TABLE public.rkbo_community_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rkbo_community_alerts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rkbo_community_alerts TO authenticated;
DROP POLICY IF EXISTS rkbo_community_alerts_owner_read ON public.rkbo_community_alerts;
CREATE POLICY rkbo_community_alerts_owner_read ON public.rkbo_community_alerts FOR SELECT TO authenticated
 USING(recipient_id=(SELECT auth.uid()) AND coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false);

CREATE OR REPLACE FUNCTION public.rkbo_trade_alert_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_to uuid; v_actor uuid; v_kind text; v_body text; v_nick text;
 v_offered text; v_requested text;
BEGIN
 IF TG_OP='INSERT' THEN
  v_to:=NEW.receiver_id;v_actor:=NEW.sender_id;v_kind:='trade_offer';
 ELSIF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status<>OLD.status THEN
  IF NEW.status='accepted' THEN
   -- Both participants receive confirmation. Sender first, receiver second.
   PERFORM public.rkbo_emit_trade_alert(NEW.sender_id,NEW.receiver_id,NEW.id,'trade_accepted',
     NEW.offered_card_id,NEW.requested_card_id);
   PERFORM public.rkbo_emit_trade_alert(NEW.receiver_id,NEW.sender_id,NEW.id,'trade_accepted',
     NEW.offered_card_id,NEW.requested_card_id);
   RETURN NEW;
  ELSIF NEW.status='declined' THEN
   v_to:=NEW.sender_id;v_actor:=NEW.receiver_id;v_kind:='trade_declined';
  ELSIF NEW.status='cancelled' THEN
   v_to:=NEW.receiver_id;v_actor:=NEW.sender_id;v_kind:='trade_cancelled';
  ELSE RETURN NEW;
  END IF;
 ELSE RETURN NEW;
 END IF;
 PERFORM public.rkbo_emit_trade_alert(v_to,v_actor,NEW.id,v_kind,
  NEW.offered_card_id,NEW.requested_card_id);
 RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.rkbo_emit_trade_alert(
 p_to uuid,p_actor uuid,p_trade uuid,p_kind text,p_offered text,p_requested text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_nick text;v_off text;v_req text;v_body text;
BEGIN
 SELECT nickname INTO v_nick FROM public.rkbo_profiles WHERE user_id=p_actor;
 SELECT name INTO v_off FROM public.rkbo_pack_cards WHERE card_id=p_offered;
 SELECT name INTO v_req FROM public.rkbo_pack_cards WHERE card_id=p_requested;
 v_nick:=coalesce(v_nick,'RKBO 회원');
 v_body:=CASE p_kind
 WHEN 'trade_offer' THEN v_nick||'님이 카드 교환을 제안했어! ('||coalesce(v_off,'선수 카드')||' ↔ '||coalesce(v_req,'선수 카드')||')'
 WHEN 'trade_accepted' THEN '카드 교환이 완료됐어! ('||coalesce(v_off,'선수 카드')||' ↔ '||coalesce(v_req,'선수 카드')||')'
 WHEN 'trade_declined' THEN v_nick||'님이 카드 교환을 거절했어.'
 WHEN 'trade_cancelled' THEN v_nick||'님이 카드 교환 요청을 취소했어.'
 ELSE '카드 교환 알림' END;
 INSERT INTO public.rkbo_community_alerts(recipient_id,trade_id,kind,actor_id,actor_nickname,body)
 VALUES(p_to,p_trade,p_kind,p_actor,v_nick,left(v_body,300))
 ON CONFLICT(recipient_id,trade_id,kind) DO NOTHING;
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_emit_trade_alert(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rkbo_trade_alert_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS rkbo_trade_notify_insert ON public.rkbo_community_trades;
CREATE TRIGGER rkbo_trade_notify_insert AFTER INSERT ON public.rkbo_community_trades
 FOR EACH ROW EXECUTE FUNCTION public.rkbo_trade_alert_trigger();
DROP TRIGGER IF EXISTS rkbo_trade_notify_update ON public.rkbo_community_trades;
CREATE TRIGGER rkbo_trade_notify_update AFTER UPDATE OF status ON public.rkbo_community_trades
 FOR EACH ROW EXECUTE FUNCTION public.rkbo_trade_alert_trigger();

CREATE OR REPLACE FUNCTION public.rkbo_community_alerts_read(p_ids bigint[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count int;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
    OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 UPDATE public.rkbo_community_alerts SET read_at=clock_timestamp()
 WHERE recipient_id=auth.uid() AND read_at IS NULL
  AND (p_ids IS NULL OR id=ANY(p_ids));
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END;$$;
REVOKE ALL ON FUNCTION public.rkbo_community_alerts_read(bigint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_alerts_read(bigint[]) TO authenticated;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
    AND schemaname='public' AND tablename='rkbo_community_highlights') THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.rkbo_community_highlights;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
    AND schemaname='public' AND tablename='rkbo_community_alerts') THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.rkbo_community_alerts;
  END IF;
 END IF;
END$$;
