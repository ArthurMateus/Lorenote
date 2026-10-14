-- Corkboard schema for Supabase. Run once in the SQL editor (Dashboard → SQL → New query).
-- Every row is owned by one user and protected by row-level security.

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  root_id      text,
  prefs        jsonb not null default '{}'::jsonb,
  display_name text,
  created_at   timestamptz not null default now()
);

create table if not exists public.elements (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users on delete cascade,
  data       jsonb not null,
  modified   bigint not null,
  updated_at timestamptz not null default now()
);
create index if not exists elements_owner_idx on public.elements (owner);

create table if not exists public.templates (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  root_id    text not null,
  elements   jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists templates_owner_idx on public.templates (owner);

alter table public.profiles  enable row level security;
alter table public.elements  enable row level security;
alter table public.templates enable row level security;

drop policy if exists "own profile"   on public.profiles;
drop policy if exists "own elements"  on public.elements;
drop policy if exists "own templates" on public.templates;
create policy "own profile"   on public.profiles  for all using (id = auth.uid())    with check (id = auth.uid());
create policy "own elements"  on public.elements  for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own templates" on public.templates for all using (owner = auth.uid()) with check (owner = auth.uid());

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists elements_touch on public.elements;
create trigger elements_touch before update on public.elements for each row execute function public.touch_updated_at();

-- create a profile row when someone signs up
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- live updates between devices
do $$ begin
  alter publication supabase_realtime add table public.elements;
exception when duplicate_object then null; end $$;

-- private file storage (used once uploads move out of the browser)
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
drop policy if exists "own files read"   on storage.objects;
drop policy if exists "own files write"  on storage.objects;
drop policy if exists "own files update" on storage.objects;
drop policy if exists "own files delete" on storage.objects;
create policy "own files read"   on storage.objects for select using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files write"  on storage.objects for insert with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files update" on storage.objects for update using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files delete" on storage.objects for delete using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
