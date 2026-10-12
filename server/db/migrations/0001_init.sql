-- 0001_init.sql — the whole schema, in dependency order.
-- Enum types first: later tables reference them.

create type role as enum ('admin', 'user');
create type account_status as enum ('healthy', 'degraded', 'cooling', 'disabled');
create type message_role as enum ('user', 'assistant', 'system');
create type severity as enum ('low', 'medium', 'high', 'critical');
create type direction as enum ('input', 'output');
create type column_type as enum ('text', 'number', 'bool', 'date');

-- ── Identity ──────────────────────────────────────────────────────────────

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  role role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Case-insensitive: "Lolo@x.com" and "lolo@x.com" are the same account.
create unique index users_email_idx on users (lower(email));

-- Module metadata only; secrets remain in a dedicated secret store.
create table module_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  module_key text not null check (module_key in (
    'messages', 'browser', 'security', 'cloud', 'reverse-engineering', 'deploy', 'design'
  )),
  display_name text not null,
  enabled boolean not null default false,
  status text not null default 'not_configured' check (
    status in ('not_configured', 'pending', 'healthy', 'degraded', 'disabled')
  ),
  endpoint_url text,
  last_checked_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_connections_owner_key_unique unique (owner_id, module_key)
);
create index module_connections_owner_idx on module_connections (owner_id, updated_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index sessions_token_idx on sessions (token_hash);
create index sessions_user_idx on sessions (user_id);

create table magic_links (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  -- Set on first use. A second attempt finds it non-null and is refused, which
  -- is what makes the link single-use.
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index magic_links_token_idx on magic_links (token_hash);
create index magic_links_email_idx on magic_links (email);

-- ── Projects and conversation ─────────────────────────────────────────────

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_idx on projects (owner_id);

-- The files an agent writes. Composite key so re-writing a path updates in
-- place rather than accumulating versions (history lives in `traces`).
create table project_files (
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, path)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'New run',
  agent text not null default 'lolo',
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_project_idx on conversations (project_id, updated_at desc);
create index conversations_user_idx on conversations (user_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role message_role not null,
  content text not null,
  agent text,
  model text,
  blocked boolean not null default false,
  guardrail text,
  guardrail_reason text,
  latency_ms integer,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);

-- ── Model pool ────────────────────────────────────────────────────────────

create table pool_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  tier text not null,
  status account_status not null default 'healthy',
  health integer not null default 100,
  in_flight integer not null default 0,
  max_slots integer not null,
  concurrency integer not null,
  successes integer not null default 0,
  failures integer not null default 0,
  last_used_at timestamptz,
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  -- A stale in_flight > 0 from a crashed process would otherwise block forever,
  -- so the boot job resets it.
  constraint pool_accounts_health_range check (health between 0 and 100),
  constraint pool_accounts_inflight_range check (in_flight >= 0 and in_flight <= max_slots)
);
create unique index pool_accounts_label_idx on pool_accounts (label);
create index pool_accounts_status_idx on pool_accounts (status, health desc);

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  account_id uuid references pool_accounts(id) on delete set null,
  model text not null,
  agent text not null,
  effort text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  latency_ms integer not null default 0,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index usage_events_created_idx on usage_events (created_at desc);
create index usage_events_model_idx on usage_events (model);

-- ── Observability ─────────────────────────────────────────────────────────

create table traces (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  prompt text not null,
  agent text not null,
  model text not null,
  account text,
  ok boolean not null default true,
  total_ms integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  -- The step-by-step record that answers "why did it answer that".
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index traces_created_idx on traces (created_at desc);

create table guardrail_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  category text not null,
  severity severity not null,
  direction direction not null,
  match text not null,
  excerpt text not null,
  created_at timestamptz not null default now()
);
create index guardrail_hits_created_idx on guardrail_hits (created_at desc);

-- ── Credentials ───────────────────────────────────────────────────────────

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  -- First 12 chars, so a key is recognisable in a list without being usable.
  prefix text not null,
  -- SHA-256. The plaintext is shown once at creation and is unrecoverable.
  secret_hash text not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index api_keys_secret_idx on api_keys (secret_hash);
create index api_keys_user_idx on api_keys (user_id);

-- ── Per-project data space ─────────────────────────────────────────────────

create table project_tables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index project_tables_name_idx on project_tables (project_id, name);

create table project_columns (
  table_id uuid not null references project_tables(id) on delete cascade,
  name text not null,
  type column_type not null default 'text',
  is_pk boolean not null default false,
  position integer not null default 0,
  primary key (table_id, name)
);

create table project_rows (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references project_tables(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index project_rows_table_idx on project_rows (table_id, created_at);
