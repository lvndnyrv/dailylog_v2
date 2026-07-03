-- ============================================
-- Incident/Injury Reporting Feature
-- ============================================
-- Run this in Supabase SQL Editor

-- Create incident_reports table
create table incident_reports (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid references children(id) on delete cascade not null,
  educator_id uuid references profiles(id) on delete set null,
  classroom_id uuid references classrooms(id) on delete set null,
  occurred_at timestamptz not null default now(),
  location text not null default 'classroom',
  severity text not null default 'minor' check (severity in ('minor', 'moderate', 'serious')),
  injury_type text not null default 'bump',
  body_parts text[] default '{}',
  description text default '',
  first_aid_given text default '',
  witnesses text[] default '{}',
  photo_paths text[] default '{}',
  notes text default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'acknowledged')),
  parent_notified_at timestamptz,
  parent_acknowledged_at timestamptz,
  parent_acknowledge_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-update timestamp trigger
create trigger incident_reports_updated_at
  before update on incident_reports
  for each row execute function update_updated_at();

-- Enable RLS
alter table incident_reports enable row level security;

-- Educators can create/read/update incidents in their classroom
create policy "Educators can insert incidents"
  on incident_reports for insert
  with check (
    get_my_role() = 'educator'
  );

create policy "Educators can view classroom incidents"
  on incident_reports for select
  using (
    get_my_role() = 'educator' and classroom_id = get_my_classroom_id()
  );

create policy "Educators can update their incidents"
  on incident_reports for update
  using (
    get_my_role() = 'educator' and educator_id = auth.uid()
  );

-- Parents can view incidents for their children
create policy "Parents can view child incidents"
  on incident_reports for select
  using (
    get_my_role() = 'parent' and child_id in (
      select child_id from parent_children where parent_id = auth.uid()
    )
  );

-- Parents can update (acknowledge) incidents for their children
create policy "Parents can acknowledge incidents"
  on incident_reports for update
  using (
    get_my_role() = 'parent' and child_id in (
      select child_id from parent_children where parent_id = auth.uid()
    )
  )
  with check (
    -- Parents can only update acknowledgment fields
    get_my_role() = 'parent'
  );

-- Create storage bucket for incident photos
insert into storage.buckets (id, name, public)
values ('incident-photos', 'incident-photos', false)
on conflict (id) do nothing;

-- Storage policies for incident photos
create policy "Educators can upload incident photos"
  on storage.objects for insert
  with check (
    bucket_id = 'incident-photos'
    and get_my_role() = 'educator'
  );

create policy "Educators can delete incident photos"
  on storage.objects for delete
  using (
    bucket_id = 'incident-photos'
    and get_my_role() = 'educator'
  );

create policy "Authenticated users can view incident photos"
  on storage.objects for select
  using (
    bucket_id = 'incident-photos'
    and auth.role() = 'authenticated'
  );

-- Enable realtime for incident_reports
alter publication supabase_realtime add table incident_reports;

