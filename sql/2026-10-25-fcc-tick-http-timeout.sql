begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.invoke_fcc_global_tick()') is null then
    raise exception 'Existing watchdog function is missing; inspect production before proceeding';
  end if;
end;
$$;

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
  select decrypted_secret into tick_url
  from vault.decrypted_secrets where name = 'fcc_tick_url' limit 1;

  select decrypted_secret into tick_secret
  from vault.decrypted_secrets where name = 'fcc_tick_cron_secret' limit 1;

  if tick_url is null or tick_secret is null then
    raise warning 'FCC global tick Vault secrets are not configured';
    return null;
  end if;

  return net.http_get(
    url := tick_url,
    headers := pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || tick_secret),
    timeout_milliseconds := 310000
  );
end;
$$;

commit;
