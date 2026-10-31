CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Delete expired activity records at least once per minute. The client also filters at the exact 24-hour boundary.
SELECT cron.schedule('rkbo-highlight-expire-after-24h','* * * * *',
 $$DELETE FROM public.rkbo_community_highlights WHERE obtained_at <= now()-interval '24 hours'$$);
DELETE FROM public.rkbo_community_highlights WHERE obtained_at <= now()-interval '24 hours';
