-- Complete the Group 22 privacy workflow: surface new parent requests to
-- center administrators, notify parents as requests progress, and audit every
-- stage transition.

create or replace function public.route_parent_data_request_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_name text;
  v_actor uuid := auth.uid();
  v_title text;
  v_body text;
begin
  select coalesce(nullif(profile.full_name, ''), profile.email, 'A parent')
  into v_parent_name
  from public.profiles profile
  where profile.id = new.profile_id;

  if tg_op = 'INSERT' then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select
      new.daycare_id,
      admin.id,
      'parent_data_request',
      case new.request_type
        when 'export' then 'New parent data export request'
        else 'New parent account deletion request'
      end,
      v_parent_name || ' submitted a privacy request. Review it in Settings.',
      jsonb_build_object(
        'type', 'parent_data_request_admin',
        'screen', 'Settings',
        'requestId', new.id,
        'requestType', new.request_type
      )
    from public.profiles admin
    where admin.daycare_id = new.daycare_id
      and admin.role in ('owner_admin', 'admin')
      and admin.archived_at is null;

    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, after
    ) values (
      new.daycare_id, v_actor, 'insert', 'parent_data_requests', new.id,
      jsonb_build_object('request_type', new.request_type, 'status', new.status)
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    v_title := case new.status
      when 'processing' then 'Your privacy request is being reviewed'
      when 'ready' then 'Your data export is ready'
      when 'completed' then 'Your privacy request was completed'
      when 'cancelled' then 'Your privacy request was cancelled'
      else 'Your privacy request was updated'
    end;
    v_body := case new.status
      when 'processing' then 'Your center has started reviewing the request. You can follow its status in Privacy & data.'
      when 'ready' then 'Open Privacy & data for the latest information from your center.'
      when 'completed' then 'Your center marked the request as handled. Contact the center if you have questions.'
      when 'cancelled' then 'The pending request is closed. You can submit another request later.'
      else 'Open Privacy & data to review the latest status.'
    end;

    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    ) values (
      new.daycare_id,
      new.profile_id,
      'parent_data_request',
      v_title,
      v_body,
      jsonb_build_object(
        'type', 'parent_data_request',
        'screen', 'ParentPrivacyData',
        'requestId', new.id,
        'requestType', new.request_type,
        'status', new.status
      )
    );

    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, before, after
    ) values (
      new.daycare_id, v_actor, 'update', 'parent_data_requests', new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists parent_data_requests_handoff on public.parent_data_requests;
create trigger parent_data_requests_handoff
  after insert or update of status on public.parent_data_requests
  for each row execute function public.route_parent_data_request_handoff();
