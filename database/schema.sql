-- Run in your Supabase project's SQL Editor.
create table if not exists public.job_searches (
  id uuid primary key default gen_random_uuid(),
  job_url text not null,
  title text not null,
  company text not null,
  created_at timestamptz not null default now()
);

create index if not exists job_searches_created_at_idx
  on public.job_searches (created_at desc, id desc);

-- Only the backend's secret key can access this table directly.
alter table public.job_searches enable row level security;
revoke all on public.job_searches from anon, authenticated;
grant select, insert on public.job_searches to service_role;
