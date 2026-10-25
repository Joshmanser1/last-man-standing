begin transaction read only;

select extversion as pg_net_version
from pg_extension where extname = 'pg_net';

select current_setting('pg_net.max_timeout_ms', true) as pg_net_max_timeout_ms;

select name, setting, unit, context, source, pending_restart
from pg_settings where name = 'pg_net.max_timeout_ms';

select pg_get_function_arguments(p.oid) as http_get_arguments,
  pg_get_function_result(p.oid) as http_get_result,
  l.lanname as language,
  md5(p.prosrc) as implementation_hash
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'net' and p.proname = 'http_get';

select p.oid, pg_get_userbyid(p.proowner) as owner, p.proacl,
  p.prosecdef as security_definer, p.proconfig,
  substring(p.prosrc from 'timeout_milliseconds[[:space:]]*:=[[:space:]]*([0-9]+)') as http_timeout_ms,
  position('fcc_tick_url' in p.prosrc) > 0 as reads_tick_url_from_vault_name,
  position('fcc_tick_cron_secret' in p.prosrc) > 0 as reads_cron_secret_from_vault_name,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p where p.oid = to_regprocedure('public.invoke_fcc_global_tick()');

select jobid, jobname, schedule, active, username,
  md5(command) as command_hash
from cron.job where jobname = 'fcc-global-lms-tick';

select id, name
from vault.secrets where name in ('fcc_tick_url', 'fcc_tick_cron_secret')
order by name;

select id, created, status_code, timed_out, error_msg
from net._http_response
where created >= now() - interval '1 hour'
order by created desc limit 12;

rollback;
