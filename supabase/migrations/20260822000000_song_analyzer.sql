-- Private Song Analyzer data only. Source media lives in the private Storage
-- bucket temporarily; no public song, chart, or source-media access is granted.
create extension if not exists pgcrypto;

create table if not exists public.song_charts (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('upload', 'youtube')),
  source_url text,
  chart jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chart_id text not null references public.song_charts(id) on delete cascade,
  source_type text not null check (source_type in ('upload', 'youtube')),
  source_object_key text,
  source_url text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'review')),
  progress integer not null default 0 check (progress between 0 and 100),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analysis_jobs_owner_created_at_idx on public.analysis_jobs (owner_id, created_at desc);
create index if not exists song_charts_owner_updated_at_idx on public.song_charts (owner_id, updated_at desc);

alter table public.song_charts enable row level security;
alter table public.analysis_jobs enable row level security;

create policy "song charts are private to their owner" on public.song_charts
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "analysis jobs are private to their owner" on public.analysis_jobs
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into storage.buckets (id, name, public) values ('faithful-keys-sources', 'faithful-keys-sources', false)
on conflict (id) do update set public = false;

create policy "users upload only to their source folder" on storage.objects
  for insert to authenticated with check (bucket_id = 'faithful-keys-sources' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "users read only their source folder" on storage.objects
  for select to authenticated using (bucket_id = 'faithful-keys-sources' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "users delete only their source folder" on storage.objects
  for delete to authenticated using (bucket_id = 'faithful-keys-sources' and (storage.foldername(name))[1] = (select auth.uid()::text));
