-- Dayline Review 0.6.6 — complemento do site para prévias compartilhadas.
-- Execute depois de contracts/feedback-envios.sql e UPDATE_TO_0.6.6.sql do app, no mesmo Supabase.
-- Reaplicável; não apaga prévias, feedbacks ou registros antigos.
begin;
do $migration$
begin
  if to_regclass('public.dayline_collab_preview_feedback') is null then
    raise exception 'Execute primeiro UPDATE_TO_0.6.6.sql do app';
  end if;
  if to_regprocedure('public.feedback_envio_v2_valido(jsonb)') is null then
    raise exception 'Execute primeiro contracts/feedback-envios.sql do site';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.dayline_collab_preview_feedback'::regclass and conname='dayline_collab_preview_feedback_documento') then
    alter table public.dayline_collab_preview_feedback
      add constraint dayline_collab_preview_feedback_documento
      check(public.feedback_envio_v2_valido(quadro)) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.dayline_collab_preview_feedback'::regclass and conname='dayline_collab_preview_feedback_count') then
    alter table public.dayline_collab_preview_feedback
      add constraint dayline_collab_preview_feedback_count
      check(changes_count=jsonb_array_length(quadro->'items')+jsonb_array_length(quadro->'paths')) not valid;
  end if;
end
$migration$;
-- Allows the site to distinguish a valid project without uploaded videos
-- from an invalid or legacy individual link.
create or replace function public.dayline_collab_preview_public_project(p_public_token uuid)
returns table(title text)
language sql stable security definer set search_path=extensions,public,pg_temp as $$
  select p.title from public.dayline_collab_preview_links l
  join public.dayline_collab_projects p on p.project_id=l.project_id
  where l.public_token=p_public_token
$$;
revoke all on function public.dayline_collab_preview_public_project(uuid) from public;
grant execute on function public.dayline_collab_preview_public_project(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
