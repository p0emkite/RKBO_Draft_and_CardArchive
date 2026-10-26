-- Keep nicknames unique even if letter case or surrounding spaces differ.
-- Existing strict unique constraint is retained for compatibility.
CREATE UNIQUE INDEX IF NOT EXISTS rkbo_profiles_nickname_normalized_unique
  ON public.rkbo_profiles ((lower(btrim(nickname))));
CREATE OR REPLACE FUNCTION public.rkbo_nickname_available(p_nickname text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.rkbo_profiles p
    WHERE lower(btrim(p.nickname)) = lower(btrim(p_nickname))
      AND p.user_id IS DISTINCT FROM auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.rkbo_nickname_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rkbo_nickname_available(text) TO authenticated;