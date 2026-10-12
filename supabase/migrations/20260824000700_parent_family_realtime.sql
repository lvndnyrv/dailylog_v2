-- Parent Mobile Groups 14/16 — keep family links and consent gates live.
-- Supabase channels only receive changes for tables in this publication.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables publication_table
     where publication_table.pubname = 'supabase_realtime'
       and publication_table.schemaname = 'public'
       and publication_table.tablename = 'parent_children'
  ) then
    alter publication supabase_realtime add table public.parent_children;
  end if;
end;
$$;
