drop policy if exists "managed branding site admins can upload" on storage.objects;
drop policy if exists "managed branding site admins can update" on storage.objects;
drop policy if exists "managed branding site admins can delete" on storage.objects;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'managed-branding',
  'managed-branding',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "managed branding site admins can upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'managed-branding'
  and (storage.foldername(name))[1] = 'managed-league-branding'
  and exists (
    select 1
    from public.site_admins sa
    where sa.user_id = auth.uid()
  )
);

create policy "managed branding site admins can update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'managed-branding'
  and (storage.foldername(name))[1] = 'managed-league-branding'
  and exists (
    select 1
    from public.site_admins sa
    where sa.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'managed-branding'
  and (storage.foldername(name))[1] = 'managed-league-branding'
  and exists (
    select 1
    from public.site_admins sa
    where sa.user_id = auth.uid()
  )
);

create policy "managed branding site admins can delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'managed-branding'
  and (storage.foldername(name))[1] = 'managed-league-branding'
  and exists (
    select 1
    from public.site_admins sa
    where sa.user_id = auth.uid()
  )
);
