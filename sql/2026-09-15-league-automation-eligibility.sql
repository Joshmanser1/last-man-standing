alter table public.leagues
add column if not exists automation_enabled boolean not null default false;
