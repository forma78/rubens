-- Rubens Syndicate — full schema
-- Supabase → SQL Editor → Run. Safe to run twice.

create extension if not exists pgcrypto;

-- 2026-08-20: multireference briefs. Additive — the old `reference` column
-- and any rows that only have it (e.g. smoke-test-3) are untouched; this
-- is only for a table created before this column existed.
alter table if exists public.briefs
  add column if not exists reference_urls jsonb not null default '[]'::jsonb;

-- 2026-08-21: RubensJournal front end (Archive/Live/Canon — docs/site-plan.md
-- C1). Two changes the new pages depend on:
--
-- 1. A human URL slug, generated on the DB side so two shifts fired the
--    same second can never collide. One row per calendar day holds that
--    day's count; the function is atomic (insert .. on conflict ..
--    returning), so concurrent inserts can't hand out the same number
--    twice — the old client-side `brief-${Date.now()}-uuid` scheme gave no
--    such guarantee and wasn't a URL anyone would want to read anyway.
-- 2. `published` now defaults true. RubensJournal is a live feed, not a
--    curated gallery waiting on a manual publish step that was never
--    built — CLAUDE.md's "a feed that fills in as it happens is the
--    reason the site exists" applies from the moment Go! is pressed, not
--    after the fact.
-- No policies on this one, deliberately: nobody needs to read or write
-- shift_counters directly, only next_shift_slug() below does, and it
-- does that as security definer — RLS enabled with zero policies is a
-- default-deny, which is exactly right for a table nothing outside this
-- one function should ever touch.
create table if not exists public.shift_counters (
  day   date primary key,
  count int  not null default 0
);
alter table public.shift_counters enable row level security;

-- security definer: this runs as the function's owner (whoever ran this
-- script in the SQL editor — Supabase's own RLS default caught the first
-- version of this function, which ran as the calling role and had no
-- grant on shift_counters at all), not as whichever role's INSERT into
-- briefs triggered this column default. search_path pinned to public so
-- a security definer function can't be tricked by a caller-controlled
-- search_path into resolving to some other `shift_counters`.
create or replace function public.next_shift_slug()
returns text language plpgsql
security definer
set search_path = public
as $$
declare
  d date := current_date;
  n int;
begin
  insert into public.shift_counters (day, count) values (d, 1)
  on conflict (day) do update set count = shift_counters.count + 1
  returning count into n;
  return to_char(d, 'YYYYMMDD') || lpad(n::text, 2, '0');
end;
$$;

alter table if exists public.briefs
  alter column slug set default public.next_shift_slug();

alter table if exists public.briefs
  alter column published set default true;

-- One real round now, not five (see the `rounds` column's own comment
-- below, in the table's create statement) — this alter is what actually
-- reaches the live table; `create table if not exists` above is a no-op
-- once the table already exists, same as slug/published's alters.
alter table if exists public.briefs
  alter column rounds set default 1;

-- ---------------------------------------------------------------- sketches
-- states saved by hand from the generator's Archive panel
create table if not exists public.sketches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'untitled',
  note       text,
  thumb      text,
  state      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sketches_user_created_idx
  on public.sketches (user_id, created_at desc);

-- ---------------------------------------------------------------- briefs
create table if not exists public.briefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug         text not null,
  instruction  text not null,
  canvas_format text,               -- e.g. '60x80' (src/syndicate/canvas.js) — set at creation, before a run exists
  base_state   jsonb,               -- palettes already locked in — null until the shift actually runs
  palette      jsonb,               -- what the analyser read from the reference
  reference    text,                -- deprecated 2026-08-20, superseded by reference_urls below — kept for old rows, nothing writes it any more
  reference_urls jsonb not null default '[]'::jsonb, -- up to 4 entries (site's A4 form / a local brief's references[]), position = the colour layer it overrides. Named `reference_urls`, not `references` — the latter is a reserved SQL word (foreign-key syntax)
  -- 2026-08-21: a shift is one real round now (proposeRound + judgeRound
  -- once, 32 variants, one real tournament) — rounds 2-5 on the site are
  -- a progressive reveal of that same round's real ratings (top 16/8/4/2),
  -- not fresh generation or judging. Owner's call: re-running the search
  -- with fresh mutations every round burned tokens with no discussion
  -- payoff a single well-judged round doesn't already give.
  rounds       int  not null default 1,
  published    boolean not null default false,
  status       text not null default 'pending',   -- pending | running | done | aborted
  cost_usd     numeric(10,4) not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, slug)
);

-- ---------------------------------------------------------------- variants
create table if not exists public.variants (
  id           uuid primary key default gen_random_uuid(),
  brief_id     uuid not null references public.briefs(id) on delete cascade,
  round        int  not null,
  label        text not null,                 -- var-07
  source       text not null,                 -- anthropic | xai | mechanical
  agent_id     text,                          -- gen-tight …
  parent_id    uuid references public.variants(id) on delete set null,
  patch        jsonb not null,
  state        jsonb not null,
  intent       text,
  render_url   text,
  rating       numeric(8,2) not null default 1500,
  disagreement numeric(5,4) not null default 0,
  survived     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists variants_brief_round_idx
  on public.variants (brief_id, round, rating desc);

-- ---------------------------------------------------------------- comparisons
-- one forced pairwise choice. provenance is the point of this table.
create table if not exists public.comparisons (
  id          uuid primary key default gen_random_uuid(),
  brief_id    uuid not null references public.briefs(id) on delete cascade,
  round       int  not null,
  judge_id    text not null,                  -- architect | old-master | …
  vendor      text not null,                  -- anthropic | xai
  model       text not null,                  -- exact model id used
  request_id  text,
  left_id     uuid not null references public.variants(id) on delete cascade,
  right_id    uuid not null references public.variants(id) on delete cascade,
  shown_first uuid not null,                  -- which one was slot A
  winner_id   uuid references public.variants(id) on delete cascade,
  why         text,
  tokens_in   int,
  tokens_out  int,
  error       text,                           -- set instead of a winner on failure
  created_at  timestamptz not null default now()
);
create index if not exists comparisons_brief_round_idx
  on public.comparisons (brief_id, round);

-- ---------------------------------------------------------------- reactions
-- the art director's own signal. kept apart from the jury on purpose.
create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  variant_id uuid not null references public.variants(id) on delete cascade,
  kind       text not null default 'like',    -- like | chosen | painted
  note       text,
  created_at timestamptz not null default now(),
  unique (user_id, variant_id, kind)
);

-- ================================================================ security
alter table public.sketches    enable row level security;
alter table public.briefs      enable row level security;
alter table public.variants    enable row level security;
alter table public.comparisons enable row level security;
alter table public.reactions   enable row level security;

-- owner: full control over own rows
do $$
declare t text;
begin
  foreach t in array array['sketches','briefs','reactions'] loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format($f$create policy %I_own on public.%I
                      for all to authenticated
                      using (user_id = auth.uid())
                      with check (user_id = auth.uid())$f$, t, t);
  end loop;
end $$;

-- variants and comparisons belong to their brief
drop policy if exists variants_own on public.variants;
create policy variants_own on public.variants for all to authenticated
  using (exists (select 1 from public.briefs b
                 where b.id = brief_id and b.user_id = auth.uid()))
  with check (exists (select 1 from public.briefs b
                      where b.id = brief_id and b.user_id = auth.uid()));

drop policy if exists comparisons_own on public.comparisons;
create policy comparisons_own on public.comparisons for all to authenticated
  using (exists (select 1 from public.briefs b
                 where b.id = brief_id and b.user_id = auth.uid()))
  with check (exists (select 1 from public.briefs b
                      where b.id = brief_id and b.user_id = auth.uid()));

-- ---------------------------------------------------------------- public site
-- anonymous readers see only what the owner published, one shift at a time.
drop policy if exists briefs_public on public.briefs;
create policy briefs_public on public.briefs
  for select to anon using (published = true);

drop policy if exists variants_public on public.variants;
create policy variants_public on public.variants
  for select to anon using (exists (select 1 from public.briefs b
                                    where b.id = brief_id and b.published));

drop policy if exists comparisons_public on public.comparisons;
create policy comparisons_public on public.comparisons
  for select to anon using (exists (select 1 from public.briefs b
                                    where b.id = brief_id and b.published));

-- Projects created after 30 May 2026 do not expose tables to the REST API
-- automatically. Without these grants the API returns nothing and the error
-- does not say why.
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete
  on public.sketches, public.briefs, public.variants, public.comparisons, public.reactions
  to authenticated;
grant select on public.variants, public.comparisons to anon;
-- briefs gets a column-scoped grant, not the blanket one above: cost_usd
-- is real spend (CLAUDE.md's "costs are real"), visible to the owner
-- (authenticated's own full-table grant above) but not to anyone reading
-- the public Archive/Live pages.
grant select (
  id, user_id, slug, instruction, canvas_format, base_state, palette,
  reference, reference_urls, rounds, published, status, created_at
) on public.briefs to anon;

-- ---------------------------------------------------------------- realtime
-- Live and Archive both watch a shift as it happens — without these,
-- Postgres Changes has nothing to stream even though RLS above already
-- lets anon read the rows. Guarded with pg_publication_tables checks
-- because `alter publication .. add table` has no native IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'briefs') then
    alter publication supabase_realtime add table public.briefs;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'variants') then
    alter publication supabase_realtime add table public.variants;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comparisons') then
    alter publication supabase_realtime add table public.comparisons;
  end if;
end $$;

-- ---------------------------------------------------------------- storage
-- reference images uploaded from the brief-creation form. Public read (the
-- object's URL is unguessable, same tradeoff the studies/ photos already
-- accept) so a run can fetch it without needing a signed URL; only an
-- authenticated owner can upload.
insert into storage.buckets (id, name, public)
values ('references', 'references', true)
on conflict (id) do nothing;

drop policy if exists references_owner_upload on storage.objects;
create policy references_owner_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'references');

drop policy if exists references_public_read on storage.objects;
create policy references_public_read on storage.objects
  for select to public
  using (bucket_id = 'references');

-- variant renders (the 768px transmission JPEG every variant already gets,
-- for the judges) — a separate bucket from references on purpose: these
-- are generated output headed for the public feed, not the owner's own
-- study photographs, and keeping them apart makes it easy to point a
-- retention/size policy at one without touching the other later.
insert into storage.buckets (id, name, public)
values ('renders', 'renders', true)
on conflict (id) do nothing;

drop policy if exists renders_owner_upload on storage.objects;
create policy renders_owner_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'renders');

drop policy if exists renders_public_read on storage.objects;
create policy renders_public_read on storage.objects
  for select to public
  using (bucket_id = 'renders');

-- ---------------------------------------------------------------- housekeeping
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists sketches_touch on public.sketches;
create trigger sketches_touch before update on public.sketches
  for each row execute function public.touch_updated_at();
