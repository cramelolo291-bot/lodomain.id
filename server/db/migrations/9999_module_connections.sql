-- 9999_module_connections.sql
-- Store per-user module configuration metadata only. Provider secrets must
-- live in a dedicated secret manager and are intentionally not stored here.
create table if not exists module_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  module_key text not null,
  display_name text not null,
  enabled boolean not null default false,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'pending', 'healthy', 'degraded', 'disabled')),
  endpoint_url text,
  last_checked_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_connections_owner_key_unique unique (owner_id, module_key),
  constraint module_connections_key_valid check (
    module_key in ('messages', 'browser', 'security', 'cloud', 'reverse-engineering', 'deploy', 'design')
  )
);
create index if not exists module_connections_owner_idx
  on module_connections (owner_id, updated_at desc);
