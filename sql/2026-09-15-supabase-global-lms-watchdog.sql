create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create or replace function public.invoke_fcc_global_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  tick_url text;
  tick_secret text;
begin
  select decrypted_secret
  into tick_url
  from vault.decrypted_secrets
  where name = 'fcc_tick_url'
  limit 1;

  select decrypted_secret
  into tick_secret
  from vault.decrypted_secrets
  where name = 'fcc_tick_cron_secret'
  limit 1;

  if tick_url is null or tick_secret is null then
    raise warning 'FCC global tick Vault secrets are not configured';
    return null;
  end if;

  return net.http_get(
    url := tick_url,
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || tick_secret
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function public.invoke_fcc_global_tick() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'fcc-global-lms-tick';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'fcc-global-lms-tick',
    '*/15 * * * *',
    'select public.invoke_fcc_global_tick();'
  );
end;
$$;
