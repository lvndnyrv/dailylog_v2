-- Make the two bounded loop functions explicit about their theoretically
-- unreachable fallthrough. This keeps PostgreSQL's function checker clean
-- without changing either function's runtime behavior or grants.

create or replace function public.create_pickup(
  p_child_id uuid,
  p_full_name text,
  p_relationship text default null,
  p_phone text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_pin text;
  v_attempts int := 0;
begin
  if not public.can_write_child(p_child_id) then
    raise exception 'No access to this child';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;

  select daycare_id into v_daycare
    from public.children
   where id = p_child_id;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 25 then
      raise exception 'Could not allocate a unique PIN — try again';
    end if;

    v_pin := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    begin
      insert into public.child_pickups (
        daycare_id, child_id, full_name, relationship, phone, pin, created_by
      ) values (
        v_daycare,
        p_child_id,
        trim(p_full_name),
        nullif(trim(p_relationship), ''),
        nullif(trim(p_phone), ''),
        v_pin,
        auth.uid()
      );
      return v_pin;
    exception when unique_violation then
      -- Try another PIN for the same center.
    end;
  end loop;

  return null;
end;
$$;

create or replace function public.next_center_open_date(
  p_daycare_id uuid,
  p_after_date date
)
returns date
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_candidate date := p_after_date + 1;
  v_checked int := 0;
begin
  if p_daycare_id is null or p_after_date is null then return null; end if;

  loop
    if extract(isodow from v_candidate) between 1 and 5
       and not exists (
         select 1
           from public.center_closures closure
          where closure.daycare_id = p_daycare_id
            and v_candidate between closure.starts_on and closure.ends_on
       ) then
      return v_candidate;
    end if;

    v_candidate := v_candidate + 1;
    v_checked := v_checked + 1;
    if v_checked > 366 then
      raise exception 'No open center date was found in the next year';
    end if;
  end loop;

  return null;
end;
$$;
