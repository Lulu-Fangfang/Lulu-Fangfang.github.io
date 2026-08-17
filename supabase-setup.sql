-- Lulu & Fangfang cloud setup for Supabase.
--
-- Before running this file, create and auto-confirm these two users in
-- Authentication > Users:
--   fangfang@login.lulufangfang.me  (recorder)
--   lulu@login.lulufangfang.me      (reviewer)
--
-- Run the entire file in Supabase > SQL Editor. It is safe to run again.

begin;

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  role text not null check (role in ('recorder', 'reviewer')),
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (household_id, role)
);

create table if not exists public.house_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.house_state enable row level security;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members member
    where member.user_id = auth.uid()
      and member.household_id = p_household_id
  );
$$;

create or replace function public.is_household_member_text(p_household_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members member
    where member.user_id = auth.uid()
      and member.household_id::text = p_household_id
  );
$$;

create or replace function public.house_cloud_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.households household
    join public.house_state state on state.household_id = household.id
    where household.slug = 'lulu-fangfang'
      and (
        select count(*)
        from public.household_members member
        where member.household_id = household.id
          and member.role in ('recorder', 'reviewer')
      ) = 2
  );
$$;

create or replace function public.get_my_household()
returns table (
  household_id uuid,
  member_role text,
  display_name text,
  payload jsonb,
  revision bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    member.household_id,
    member.role,
    member.display_name,
    state.payload,
    state.revision,
    state.updated_at
  from public.household_members member
  join public.house_state state on state.household_id = member.household_id
  where member.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.save_house_state(
  p_payload jsonb,
  p_expected_revision bigint
)
returns table (new_revision bigint, saved_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_member_role text;
  v_existing_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
  end if;

  select member.household_id, member.role
  into v_household_id, v_member_role
  from public.household_members member
  where member.user_id = auth.uid();

  if v_household_id is null then
    raise exception 'MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  select state.payload
  into v_existing_payload
  from public.house_state state
  where state.household_id = v_household_id;

  -- Both members may record shared life. Only the reviewer may change
  -- household rules, the wish catalog, or redemption history after bootstrap.
  if v_member_role = 'recorder'
     and coalesce(v_existing_payload, '{}'::jsonb) <> '{}'::jsonb
     and (
       (p_payload -> 'settings') is distinct from (v_existing_payload -> 'settings')
       or (p_payload -> 'wishes') is distinct from (v_existing_payload -> 'wishes')
       or (p_payload -> 'redemptions') is distinct from (v_existing_payload -> 'redemptions')
     ) then
    raise exception 'REVIEWER_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return query
  update public.house_state state
  set payload = p_payload,
      revision = state.revision + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where state.household_id = v_household_id
    and state.revision = p_expected_revision
  returning state.revision, state.updated_at;

  if not found then
    raise exception 'SYNC_CONFLICT' using errcode = '40001';
  end if;
end;
$$;

revoke all on public.households from anon, authenticated;
revoke all on public.household_members from anon, authenticated;
revoke all on public.house_state from anon, authenticated;
grant select on public.households, public.household_members, public.house_state to authenticated;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_member_text(text) from public;
revoke all on function public.house_cloud_ready() from public;
revoke all on function public.get_my_household() from public;
revoke all on function public.save_house_state(jsonb, bigint) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_member_text(text) to authenticated;
grant execute on function public.house_cloud_ready() to anon, authenticated;
grant execute on function public.get_my_household() to authenticated;
grant execute on function public.save_house_state(jsonb, bigint) to authenticated;

drop policy if exists "members read own membership" on public.household_members;
create policy "members read own membership"
on public.household_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists "members read household" on public.households;
create policy "members read household"
on public.households for select to authenticated
using (public.is_household_member(id));

drop policy if exists "members read house state" on public.house_state;
create policy "members read house state"
on public.house_state for select to authenticated
using (public.is_household_member(household_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'moment-images',
  'moment-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "house members read images" on storage.objects;
create policy "house members read images"
on storage.objects for select to authenticated
using (
  bucket_id = 'moment-images'
  and public.is_household_member_text((storage.foldername(name))[1])
);

drop policy if exists "house members upload images" on storage.objects;
create policy "house members upload images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'moment-images'
  and public.is_household_member_text((storage.foldername(name))[1])
);

drop policy if exists "house members update images" on storage.objects;
create policy "house members update images"
on storage.objects for update to authenticated
using (
  bucket_id = 'moment-images'
  and public.is_household_member_text((storage.foldername(name))[1])
)
with check (
  bucket_id = 'moment-images'
  and public.is_household_member_text((storage.foldername(name))[1])
);

drop policy if exists "house members delete images" on storage.objects;
create policy "house members delete images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'moment-images'
  and public.is_household_member_text((storage.foldername(name))[1])
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'house_state'
  ) then
    alter publication supabase_realtime add table public.house_state;
  end if;
end;
$$;

-- Link the two pre-created Auth users to one private household.
do $$
declare
  v_household_id uuid;
  v_recorder_id uuid;
  v_reviewer_id uuid;
begin
  select id into v_recorder_id
  from auth.users
  where lower(email) = 'fangfang@login.lulufangfang.me';

  select id into v_reviewer_id
  from auth.users
  where lower(email) = 'lulu@login.lulufangfang.me';

  if v_recorder_id is null or v_reviewer_id is null then
    raise exception 'Create and auto-confirm both login users before running the membership block.';
  end if;

  insert into public.households (slug, name)
  values ('lulu-fangfang', '路路与方方的小家')
  on conflict (slug) do update set name = excluded.name
  returning id into v_household_id;

  insert into public.household_members (user_id, household_id, role, display_name)
  values
    (v_recorder_id, v_household_id, 'recorder', '方方'),
    (v_reviewer_id, v_household_id, 'reviewer', '路路小皇帝')
  on conflict (user_id) do update
  set household_id = excluded.household_id,
      role = excluded.role,
      display_name = excluded.display_name;

  insert into public.house_state (household_id)
  values (v_household_id)
  on conflict (household_id) do nothing;
end;
$$;

commit;

notify pgrst, 'reload schema';
