-- Run this once in Supabase: SQL Editor -> New query -> paste this -> Run

create table if not exists kv_store (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value text,
  owner uuid not null references auth.users(id) on delete cascade,
  shared boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (owner, key)
);

alter table kv_store enable row level security;

-- Anyone signed in can read their own rows, or any row marked shared
create policy "read own or shared rows"
on kv_store for select
to authenticated
using (owner = auth.uid() or shared = true);

-- You can always write your own personal (non-shared) rows.
-- Only the teacher account can write rows marked shared = true.
create policy "write own rows, shared restricted to teacher"
on kv_store for insert
to authenticated
with check (
  owner = auth.uid()
  and (shared = false or auth.jwt() ->> 'email' = 'dhayabala12@gmail.com')
);

create policy "update own rows, shared restricted to teacher"
on kv_store for update
to authenticated
using (owner = auth.uid())
with check (
  owner = auth.uid()
  and (shared = false or auth.jwt() ->> 'email' = 'dhayabala12@gmail.com')
);

create policy "delete own rows"
on kv_store for delete
to authenticated
using (owner = auth.uid());
