-- Cafe chat has no posting cooldown or count quota.
-- Retain authenticated user verification and 240-character cap.
CREATE OR REPLACE FUNCTION public.rkbo_community_chat_send(p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_user uuid:=auth.uid();v_body text:=btrim(coalesce(p_body,''));v_row public.rkbo_community_chat_messages%rowtype;
BEGIN
 IF v_user IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
    OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Google 로그인이 필요합니다' USING ERRCODE='28000';
 END IF;
 IF length(v_body)<1 OR length(v_body)>240 THEN
  RAISE EXCEPTION '메시지는 1~240자로 작성해 주세요' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.rkbo_community_chat_messages(user_id,body) VALUES(v_user,v_body) RETURNING * INTO v_row;
 RETURN jsonb_build_object('id',v_row.id,'created_at',v_row.created_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.rkbo_community_chat_send(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rkbo_community_chat_send(text) TO authenticated;
