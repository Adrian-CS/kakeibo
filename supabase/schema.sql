-- Kakeibo · esquema para la sincronizacion
--
-- Pegalo tal cual en Supabase → SQL Editor → New query → Run.
-- Crea una sola tabla: una fila por usuario con todo el documento en JSON.
-- Es deliberadamente simple; la fusion de cambios la hace la aplicacion.

create table if not exists public.kakeibo_docs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Sin RLS cualquiera con la clave publica leeria todo: esto es obligatorio.
alter table public.kakeibo_docs enable row level security;

-- Cada usuario solo ve y escribe su propia fila.
drop policy if exists "kakeibo_docs_own_row" on public.kakeibo_docs;
create policy "kakeibo_docs_own_row"
  on public.kakeibo_docs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Comprobacion rapida: con la sesion abierta en la app, esto deberia devolver
-- una fila (y ninguna si aun no has sincronizado).
--   select user_id, updated_at, jsonb_array_length(data -> 'expenses') as apuntes
--   from public.kakeibo_docs;
