-- Kakeibo · vinculo de pareja (dos cuentas separadas + lectura mutua)
--
-- Requiere que supabase/schema.sql ya este aplicado (tabla kakeibo_docs).
-- Pegalo tal cual en Supabase → SQL Editor → New query → Run. Los dos
-- miembros de la pareja deben usar el MISMO proyecto de Supabase, cada uno
-- con su propia cuenta/correo: las filas ya quedan separadas por RLS aunque
-- compartan proyecto.
--
-- Diseno de seguridad: ninguna transicion de estado pasa por un UPDATE o
-- DELETE directo del cliente -- solo hay politicas de INSERT y SELECT en
-- household_links. Aceptar, rechazar, cancelar y desvincular son siempre
-- funciones "security definer" acotadas, para controlar exactamente que
-- columnas cambian sin abrir la puerta a que alguien manipule una fila ajena.

create table if not exists public.household_links (
  id             uuid primary key default gen_random_uuid(),
  inviter_id     uuid not null references auth.users (id) on delete cascade,
  invitee_email  text not null,
  invitee_id     uuid references auth.users (id) on delete cascade,
  status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  constraint household_links_not_self check (invitee_id is null or invitee_id <> inviter_id)
);

-- como mucho una invitacion pendiente por pareja (inviter, correo)
create unique index if not exists household_links_one_pending
  on public.household_links (inviter_id, lower(invitee_email))
  where status = 'pending';

alter table public.household_links enable row level security;

-- enviar invitacion: solo en mi nombre, y nunca a mi propio correo (el
-- correo verificado viene del JWT firmado por Supabase, no de lo que mande
-- el cliente en el body, asi que no se puede falsear)
drop policy if exists "household_links_send" on public.household_links;
create policy "household_links_send"
  on public.household_links
  for insert
  with check (
    inviter_id = auth.uid()
    and lower(invitee_email) <> lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ver: mis invitaciones enviadas, cualquier vinculo (aceptado o no) donde yo
-- sea una de las dos partes, y las pendientes dirigidas a mi correo
drop policy if exists "household_links_visible" on public.household_links;
create policy "household_links_visible"
  on public.household_links
  for select
  using (
    inviter_id = auth.uid()
    or invitee_id = auth.uid()
    or (status = 'pending' and lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );

-- deliberadamente sin politica de update/delete: todo cambio de estado pasa
-- por las funciones de abajo.

-- ---------------------------------------------------------------------- --
-- Funciones RPC (security definer): "set search_path = public" evita el
-- ataque clasico de secuestro de search_path en funciones con permisos
-- elevados.
-- ---------------------------------------------------------------------- --

create or replace function public.accept_household_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_invite public.household_links;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'no autenticado';
  end if;

  select * into v_invite from public.household_links
    where id = p_invite_id and status = 'pending'
    for update;
  if not found then
    raise exception 'invitacion no encontrada o ya resuelta';
  end if;
  if lower(v_invite.invitee_email) <> lower(v_email) then
    raise exception 'esta invitacion no es para tu cuenta';
  end if;
  if v_invite.inviter_id = auth.uid() then
    raise exception 'no puedes aceptar tu propia invitacion';
  end if;

  -- como mucho una pareja activa por cuenta: rompe cualquier vinculo
  -- aceptado previo de cualquiera de los dos antes de crear el nuevo
  update public.household_links
    set status = 'revoked', responded_at = now()
    where status = 'accepted'
      and (auth.uid() in (inviter_id, invitee_id)
           or v_invite.inviter_id in (inviter_id, invitee_id));

  -- descarta cualquier otra invitacion pendiente dirigida a este correo
  update public.household_links
    set status = 'revoked', responded_at = now()
    where status = 'pending' and id <> p_invite_id and lower(invitee_email) = lower(v_email);

  update public.household_links
    set status = 'accepted', invitee_id = auth.uid(), responded_at = now()
    where id = p_invite_id;
end;
$$;

create or replace function public.decline_household_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  update public.household_links
    set status = 'declined', invitee_id = auth.uid(), responded_at = now()
    where id = p_invite_id and status = 'pending'
      and v_email is not null and lower(invitee_email) = lower(v_email);
  if not found then raise exception 'invitacion no encontrada o ya resuelta'; end if;
end;
$$;

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.household_links
    set status = 'revoked', responded_at = now()
    where id = p_invite_id and inviter_id = auth.uid() and status = 'pending';
  if not found then raise exception 'invitacion no encontrada o ya resuelta'; end if;
end;
$$;

create or replace function public.unlink_household(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.household_links
    set status = 'revoked', responded_at = now()
    where id = p_invite_id and status = 'accepted' and auth.uid() in (inviter_id, invitee_id);
  if not found then raise exception 'vinculo no encontrado'; end if;
end;
$$;

-- por defecto Postgres concede EXECUTE a PUBLIC (incluye "anon"): hay que
-- revocarlo explicitamente y dar solo a usuarios autenticados
revoke all on function public.accept_household_invite(uuid) from public;
revoke all on function public.decline_household_invite(uuid) from public;
revoke all on function public.revoke_household_invite(uuid) from public;
revoke all on function public.unlink_household(uuid) from public;
grant execute on function public.accept_household_invite(uuid) to authenticated;
grant execute on function public.decline_household_invite(uuid) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
grant execute on function public.unlink_household(uuid) to authenticated;

-- ---------------------------------------------------------------------- --
-- kakeibo_docs: lectura (solo select, nunca escritura) del documento de la
-- pareja una vez aceptado el vinculo. La politica "kakeibo_docs_own_row" de
-- schema.sql sigue intacta y es la unica que aplica a insert/update/delete;
-- esta solo anade SELECT (Postgres combina politicas permisivas del mismo
-- comando con OR), asi que el efecto es "veo mi fila, o la de mi pareja
-- aceptada".
-- ---------------------------------------------------------------------- --
drop policy if exists "kakeibo_docs_partner_read" on public.kakeibo_docs;
create policy "kakeibo_docs_partner_read"
  on public.kakeibo_docs
  for select
  using (
    exists (
      select 1 from public.household_links hl
      where hl.status = 'accepted'
        and (
          (hl.inviter_id = kakeibo_docs.user_id and hl.invitee_id = auth.uid())
          or (hl.invitee_id = kakeibo_docs.user_id and hl.inviter_id = auth.uid())
        )
    )
  );

-- Comprobacion rapida, con sesion abierta en la app:
--   select * from household_links;
--   select user_id, updated_at from kakeibo_docs; -- tu fila y la de tu pareja si esta vinculada
