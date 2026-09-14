import {writeFile,copyFile} from 'node:fs/promises';
import {canvasSchema} from '../feedback/contract.js';
const sql = `-- Apply after setup-remote.sql. Preserves the legacy feedback_canvas v1 table.
begin;
create extension if not exists pg_jsonschema with schema extensions;
create or replace function public.feedback_envio_v2_valido(documento jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $function$
begin
  if documento is null or not extensions.jsonb_matches_schema($schema$${JSON.stringify(canvasSchema)}$schema$::json, documento) then return false; end if;
  if jsonb_array_length(documento->'items') + jsonb_array_length(documento->'paths') = 0 then return false; end if;
  if exists (select 1 from (select i->>'id' id from jsonb_array_elements(documento->'items') i union all select p->>'id' from jsonb_array_elements(documento->'paths') p) entries group by id having count(*)>1) then return false; end if;
  if exists (select 1 from jsonb_array_elements(documento->'items') i where i ? 'assetId' and not ((documento->'assets') ? (i->>'assetId'))) then return false; end if;
  if exists (select 1 from jsonb_array_elements(documento->'paths') p where p ? 'from' and (p->>'from'=p->>'to' or not exists (select 1 from jsonb_array_elements(documento->'items') i where i->>'id'=p->>'from') or not exists (select 1 from jsonb_array_elements(documento->'items') i where i->>'id'=p->>'to'))) then return false; end if;
  return true;
end;
$function$;
revoke all on function public.feedback_envio_v2_valido(jsonb) from public;
grant execute on function public.feedback_envio_v2_valido(jsonb) to anon, authenticated, service_role;

create table if not exists public.feedback_envios (
  id uuid primary key,
  id_comissao text not null references public.chaves_acesso(id_comissao) on delete cascade,
  quadro jsonb not null,
  criado_em timestamptz not null default now(),
  constraint feedback_envios_documento check (public.feedback_envio_v2_valido(quadro)),
  constraint feedback_envios_tamanho check (octet_length(quadro::text) <= 5242880)
);
create index if not exists feedback_envios_comissao_data on public.feedback_envios(id_comissao,criado_em desc,id desc);
alter table public.feedback_envios enable row level security;
revoke all on public.feedback_envios from public,anon,authenticated;
grant select on public.feedback_envios to anon,authenticated;
grant insert (id,id_comissao,quadro) on public.feedback_envios to anon,authenticated;
drop policy if exists feedback_envios_chave on public.feedback_envios;
create policy feedback_envios_chave on public.feedback_envios as restrictive for all to anon,authenticated
  using (exists (select 1 from public.chaves_acesso a where a.id_comissao=feedback_envios.id_comissao and a.chave::text=(select public.dayline_preview_key())))
  with check (exists (select 1 from public.chaves_acesso a where a.id_comissao=feedback_envios.id_comissao and a.chave::text=(select public.dayline_preview_key())));
drop policy if exists feedback_envios_ler on public.feedback_envios;
create policy feedback_envios_ler on public.feedback_envios for select to anon,authenticated using (true);
drop policy if exists feedback_envios_enviar on public.feedback_envios;
create policy feedback_envios_enviar on public.feedback_envios for insert to anon,authenticated with check (true);
comment on table public.feedback_envios is 'Envios imutáveis do canvas v2 por comissão. Imagens raster embutidas; máximo 5 MB. Leitura e criação somente com x-preview-key.';
notify pgrst, 'reload schema';
commit;
`;
await writeFile(new URL('../contracts/feedback-envios.sql',import.meta.url),sql);
await copyFile(new URL('../contracts/feedback-envios.sql',import.meta.url),new URL('./app/supabase/migrations/20260913_feedback_envios.sql',import.meta.url));
