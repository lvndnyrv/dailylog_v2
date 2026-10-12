-- Delivered broadcasts are compliance and communication records. Keep their
-- content, audience, delivery metrics, read receipts, and RSVP history intact.
-- Unpublished scheduled drafts remain editable/removable through the existing
-- permission policies.

create or replace function public.protect_delivered_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- System maintenance and migrations retain their existing authority. The
  -- authenticated application boundary is where accidental/destructive edits
  -- must be rejected.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.published_at is not null or old.cancelled_at is not null then
      raise exception 'Delivered or cancelled announcements cannot be deleted';
    end if;
    return old;
  end if;

  if old.published_at is not null or old.cancelled_at is not null then
    raise exception 'Delivered or cancelled announcements cannot be edited';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_delivered_announcement
  on public.announcements;
create trigger protect_delivered_announcement
  before update or delete on public.announcements
  for each row execute function public.protect_delivered_announcement();

revoke all on function public.protect_delivered_announcement()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
