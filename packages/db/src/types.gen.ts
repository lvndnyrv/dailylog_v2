// ============================================================================
// PLACEHOLDER — replace by running `pnpm gen:types` against a running database
// (supabase gen types typescript --local > packages/db/src/types.gen.ts).
// Hand-written subset of the Phase 0 schema, just enough for Phase 0/1 queries
// to typecheck. Shapes mirror what supabase gen emits.
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      daycares: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          phone: string | null;
          created_by: string | null;
          active: boolean;
          timezone: string;
          time_tracking_enabled: boolean;
          ratio_alert_after_minutes: number;
          ratio_notify_floaters: boolean;
          ratio_block_checkins: boolean;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          address?: string | null;
          phone?: string | null;
          created_by?: string | null;
          active?: boolean;
          timezone?: string;
          time_tracking_enabled?: boolean;
          ratio_alert_after_minutes?: number;
          ratio_notify_floaters?: boolean;
          ratio_block_checkins?: boolean;
        };
        Update: {
          name?: string;
          address?: string | null;
          phone?: string | null;
          active?: boolean;
          timezone?: string;
          time_tracking_enabled?: boolean;
          ratio_alert_after_minutes?: number;
          ratio_notify_floaters?: boolean;
          ratio_block_checkins?: boolean;
        };
        Relationships: [];
      };
      profile_daycare_memberships: {
        Row: {
          profile_id: string;
          daycare_id: string;
          group_name: string;
          location_label: string;
          color: string;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          daycare_id: string;
          group_name: string;
          location_label: string;
          color?: string;
        };
        Update: {
          group_name?: string;
          location_label?: string;
          color?: string;
        };
        Relationships: [];
      };
      classrooms: {
        Row: {
          id: string;
          daycare_id: string;
          name: string;
          age_group: string | null;
          min_age_months: number | null;
          max_age_months: number | null;
          capacity: number | null;
          ratio_children_per_educator: number | null;
          opens_on: string | null;
          nap_start: string | null;
          nap_end: string | null;
          lead_educator_id: string | null;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          name: string;
          age_group?: string | null;
          min_age_months?: number | null;
          max_age_months?: number | null;
          capacity?: number | null;
          ratio_children_per_educator?: number | null;
          opens_on?: string | null;
          nap_start?: string | null;
          nap_end?: string | null;
          lead_educator_id?: string | null;
        };
        Update: {
          name?: string;
          age_group?: string | null;
          min_age_months?: number | null;
          max_age_months?: number | null;
          capacity?: number | null;
          ratio_children_per_educator?: number | null;
          opens_on?: string | null;
          nap_start?: string | null;
          nap_end?: string | null;
          lead_educator_id?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          display_name: string | null;
          role: string;
          daycare_id: string | null;
          classroom_id: string | null;
          phone: string | null;
          avatar_url: string | null;
          center_role_id: string | null;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          display_name?: string | null;
          role: string;
          daycare_id?: string | null;
          classroom_id?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          center_role_id?: string | null;
        };
        Update: {
          full_name?: string;
          display_name?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          classroom_id?: string | null;
          center_role_id?: string | null;
        };
        Relationships: [];
      };
      children: {
        Row: {
          id: string;
          daycare_id: string;
          classroom_id: string | null;
          first_name: string;
          last_name: string;
          preferred_name: string | null;
          pronouns: string | null;
          date_of_birth: string | null;
          photo_url: string | null;
          allergies: string[] | null;
          medical_notes: string | null;
          dietary_needs: string | null;
          home_address: string | null;
          emergency_contacts: Json;
          setup_state: Json;
          enrolled_on: string | null;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          classroom_id?: string | null;
          first_name: string;
          last_name: string;
          preferred_name?: string | null;
          pronouns?: string | null;
          date_of_birth?: string | null;
          photo_url?: string | null;
          allergies?: string[] | null;
          medical_notes?: string | null;
          dietary_needs?: string | null;
          home_address?: string | null;
          emergency_contacts?: Json;
          setup_state?: Json;
          enrolled_on?: string | null;
        };
        Update: {
          classroom_id?: string | null;
          first_name?: string;
          last_name?: string;
          preferred_name?: string | null;
          pronouns?: string | null;
          date_of_birth?: string | null;
          photo_url?: string | null;
          allergies?: string[] | null;
          medical_notes?: string | null;
          dietary_needs?: string | null;
          home_address?: string | null;
          emergency_contacts?: Json;
          setup_state?: Json;
          enrolled_on?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string | null;
          profile_id: string | null;
          title: string;
          category: string | null;
          storage_path: string;
          mime_type: string | null;
          size_bytes: number | null;
          expires_on: string | null;
          uploaded_by: string | null;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          child_id?: string | null;
          profile_id?: string | null;
          title: string;
          category?: string | null;
          storage_path: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          expires_on?: string | null;
          uploaded_by?: string | null;
          archived_at?: string | null;
        };
        Update: {
          title?: string;
          category?: string | null;
          storage_path?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          expires_on?: string | null;
          uploaded_by?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      educator_classrooms: {
        Row: {
          educator_id: string;
          classroom_id: string;
          created_at: string | null;
        };
        Insert: {
          educator_id: string;
          classroom_id: string;
        };
        Update: {
          classroom_id?: string;
        };
        Relationships: [];
      };
      staff_members: {
        Row: {
          id: string;
          daycare_id: string;
          profile_id: string | null;
          job_title: string | null;
          employment_type: string | null;
          started_on: string | null;
          ended_on: string | null;
          certifications: Json;
          status: string;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          profile_id?: string | null;
          job_title?: string | null;
          employment_type?: string | null;
          started_on?: string | null;
          certifications?: Json;
          status?: string;
        };
        Update: {
          job_title?: string | null;
          employment_type?: string | null;
          started_on?: string | null;
          ended_on?: string | null;
          certifications?: Json;
          status?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      staff_invites: {
        Row: {
          id: string;
          daycare_id: string;
          email: string;
          role: string;
          classroom_id: string | null;
          code: string;
          invited_by: string | null;
          accepted_at: string | null;
          accepted_by: string | null;
          expires_at: string | null;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          email: string;
          role: string;
          classroom_id?: string | null;
          code: string;
          expires_at?: string | null;
        };
        Update: { expires_at?: string | null };
        Relationships: [];
      };
      staff_shifts: {
        Row: {
          id: string;
          daycare_id: string;
          staff_member_id: string;
          classroom_id: string | null;
          starts_at: string;
          ends_at: string;
          unpaid_break_minutes: number;
          status: string;
          notes: string | null;
          created_by: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          staff_member_id: string;
          classroom_id?: string | null;
          starts_at: string;
          ends_at: string;
          unpaid_break_minutes?: number;
          status?: string;
          notes?: string | null;
        };
        Update: {
          classroom_id?: string | null;
          starts_at?: string;
          ends_at?: string;
          unpaid_break_minutes?: number;
          status?: string;
          notes?: string | null;
          published_at?: string | null;
        };
        Relationships: [];
      };
      staff_time_entries: {
        Row: {
          id: string;
          daycare_id: string;
          staff_member_id: string;
          shift_id: string | null;
          classroom_id: string | null;
          clocked_in_at: string;
          clocked_out_at: string | null;
          break_minutes: number;
          source: string;
          status: string;
          notes: string | null;
          created_by: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          staff_member_id: string;
          shift_id?: string | null;
          classroom_id?: string | null;
          clocked_in_at: string;
          clocked_out_at?: string | null;
          break_minutes?: number;
          source?: string;
          status?: string;
          notes?: string | null;
        };
        Update: {
          shift_id?: string | null;
          classroom_id?: string | null;
          clocked_in_at?: string;
          clocked_out_at?: string | null;
          break_minutes?: number;
          status?: string;
          notes?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      staff_time_off_requests: {
        Row: {
          id: string;
          daycare_id: string;
          staff_member_id: string;
          starts_on: string;
          ends_on: string;
          kind: string;
          status: string;
          reason: string | null;
          decision_notes: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          staff_member_id: string;
          starts_on: string;
          ends_on: string;
          kind?: string;
          status?: string;
          reason?: string | null;
        };
        Update: {
          starts_on?: string;
          ends_on?: string;
          kind?: string;
          status?: string;
          reason?: string | null;
          decision_notes?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
        };
        Relationships: [];
      };
      room_coverage_assignments: {
        Row: {
          id: string;
          daycare_id: string;
          classroom_id: string;
          staff_member_id: string;
          starts_at: string;
          ends_at: string;
          status: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          classroom_id: string;
          staff_member_id: string;
          starts_at: string;
          ends_at: string;
          status?: string;
          notes?: string | null;
        };
        Update: {
          classroom_id?: string;
          staff_member_id?: string;
          starts_at?: string;
          ends_at?: string;
          status?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
      room_transition_plans: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          from_classroom_id: string;
          to_classroom_id: string;
          move_on: string;
          transition_week: boolean;
          status: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          child_id: string;
          from_classroom_id: string;
          to_classroom_id: string;
          move_on: string;
          transition_week?: boolean;
          status?: string;
          notes?: string | null;
        };
        Update: {
          to_classroom_id?: string;
          move_on?: string;
          transition_week?: boolean;
          status?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
      room_combinations: {
        Row: {
          id: string;
          daycare_id: string;
          period: string;
          source_classroom_id: string | null;
          host_classroom_id: string | null;
          starts_at: string;
          ends_at: string;
          enabled: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          period: string;
          source_classroom_id?: string | null;
          host_classroom_id?: string | null;
          starts_at: string;
          ends_at: string;
          enabled?: boolean;
        };
        Update: {
          source_classroom_id?: string | null;
          host_classroom_id?: string | null;
          starts_at?: string;
          ends_at?: string;
          enabled?: boolean;
        };
        Relationships: [];
      };
      parent_children: {
        Row: {
          parent_id: string;
          child_id: string;
          relationship: string | null;
          pickup_authorized: boolean;
          is_primary: boolean;
          consent_given_at: string | null;
          created_at: string | null;
        };
        Insert: {
          parent_id: string;
          child_id: string;
          relationship?: string | null;
          pickup_authorized?: boolean;
          is_primary?: boolean;
          consent_given_at?: string | null;
        };
        Update: {
          relationship?: string | null;
          pickup_authorized?: boolean;
          is_primary?: boolean;
        };
        Relationships: [];
      };
      families: {
        Row: {
          id: string;
          daycare_id: string;
          display_name: string;
          primary_contact_id: string | null;
          billing_email: string | null;
          billing_phone: string | null;
          status: string;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          display_name: string;
          primary_contact_id?: string | null;
          billing_email?: string | null;
          billing_phone?: string | null;
          status?: string;
          archived_at?: string | null;
        };
        Update: {
          display_name?: string;
          primary_contact_id?: string | null;
          billing_email?: string | null;
          billing_phone?: string | null;
          status?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      family_members: {
        Row: {
          family_id: string;
          profile_id: string;
          role: string;
          relationship: string | null;
          receives_messages: boolean;
          receives_billing: boolean;
          created_at: string;
        };
        Insert: {
          family_id: string;
          profile_id: string;
          role?: string;
          relationship?: string | null;
          receives_messages?: boolean;
          receives_billing?: boolean;
        };
        Update: {
          role?: string;
          relationship?: string | null;
          receives_messages?: boolean;
          receives_billing?: boolean;
        };
        Relationships: [];
      };
      family_children: {
        Row: {
          family_id: string;
          child_id: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          family_id: string;
          child_id: string;
          is_primary?: boolean;
        };
        Update: { is_primary?: boolean };
        Relationships: [];
      };
      child_pickups: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          full_name: string;
          relationship: string | null;
          phone: string | null;
          pin: string;
          is_primary: boolean;
          created_by: string | null;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          child_id: string;
          full_name: string;
          relationship?: string | null;
          phone?: string | null;
          pin: string;
          is_primary?: boolean;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Update: {
          full_name?: string;
          relationship?: string | null;
          phone?: string | null;
          pin?: string;
          is_primary?: boolean;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      child_invite_codes: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          code: string;
          email: string | null;
          relationship: string | null;
          created_by: string | null;
          used_at: string | null;
          used_by: string | null;
          expires_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          child_id: string;
          code: string;
          email?: string | null;
          relationship?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
        };
        Update: { used_at?: string | null; expires_at?: string | null };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          date: string;
          checked_in_at: string | null;
          checked_in_by: string | null;
          checked_out_at: string | null;
          checked_out_by: string | null;
          method: string | null;
          status: string;
          absence_reason: string | null;
          dropped_off_by: string | null;
          picked_up_by: string | null;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          child_id: string;
          date?: string;
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          checked_out_at?: string | null;
          checked_out_by?: string | null;
          method?: string | null;
          status?: string;
          absence_reason?: string | null;
          dropped_off_by?: string | null;
          picked_up_by?: string | null;
          notes?: string | null;
        };
        Update: {
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          checked_out_at?: string | null;
          checked_out_by?: string | null;
          method?: string | null;
          status?: string;
          absence_reason?: string | null;
          dropped_off_by?: string | null;
          picked_up_by?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      medication_authorizations: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          parent_id: string | null;
          name: string;
          dosage: string;
          schedule: string | null;
          notes: string | null;
          active: boolean;
          start_date: string | null;
          end_date: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          child_id: string;
          parent_id?: string | null;
          name: string;
          dosage: string;
          schedule?: string | null;
          notes?: string | null;
          active?: boolean;
        };
        Update: {
          parent_id?: string | null;
          name?: string;
          dosage?: string;
          schedule?: string | null;
          notes?: string | null;
          active?: boolean;
          end_date?: string | null;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          daycare_id: string;
          family_id: string | null;
          child_id: string | null;
          subject: string | null;
          kind: string;
          last_message_at: string | null;
          archived_at: string | null;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          family_id?: string | null;
          child_id?: string | null;
          subject?: string | null;
          kind?: string;
        };
        Update: {
          family_id?: string | null;
          child_id?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          daycare_id: string;
          conversation_id: string | null;
          child_id: string | null;
          sender_id: string | null;
          body: string;
          read_at: string | null;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          conversation_id?: string | null;
          child_id?: string | null;
          sender_id?: string | null;
          body: string;
        };
        Update: { read_at?: string | null };
        Relationships: [];
      };
      announcements: {
        Row: {
          id: string;
          daycare_id: string;
          classroom_id: string | null;
          author_id: string | null;
          title: string;
          body: string;
          pinned: boolean | null;
          rsvp_enabled: boolean;
          event_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          classroom_id?: string | null;
          author_id?: string | null;
          title: string;
          body: string;
          pinned?: boolean;
          rsvp_enabled?: boolean;
          event_at?: string | null;
        };
        Update: { pinned?: boolean };
        Relationships: [];
      };
      incident_reports: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          educator_id: string | null;
          classroom_id: string | null;
          occurred_at: string;
          location: string;
          severity: string;
          injury_type: string;
          body_parts: string[] | null;
          description: string;
          first_aid_given: string;
          witnesses: string[] | null;
          photo_paths: string[] | null;
          notes: string;
          status: string;
          signed_off_by: string | null;
          signed_off_at: string | null;
          parent_notified_at: string | null;
          parent_acknowledged_at: string | null;
          parent_acknowledge_name: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          child_id: string;
          educator_id?: string | null;
          classroom_id?: string | null;
          occurred_at?: string;
          location?: string;
          severity?: string;
          injury_type?: string;
          body_parts?: string[] | null;
          description?: string;
          first_aid_given?: string;
          status?: string;
        };
        Update: {
          status?: string;
          signed_off_by?: string | null;
          signed_off_at?: string | null;
          parent_notified_at?: string | null;
          notes?: string;
        };
        Relationships: [];
      };
      enrollments: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string | null;
          classroom_id: string | null;
          child_first_name: string | null;
          child_last_name: string | null;
          child_date_of_birth: string | null;
          guardian_name: string | null;
          guardian_email: string | null;
          guardian_phone: string | null;
          stage: string;
          waitlist_position: number | null;
          desired_start_date: string | null;
          source: string | null;
          notes: string | null;
          schedule: Json;
          application_data: Json;
          documents_status: Json;
          application_progress: number;
          tour_at: string | null;
          tour_host_id: string | null;
          tour_outcome: string | null;
          tour_notes: string | null;
          offer_sent_at: string | null;
          offer_expires_at: string | null;
          offer_viewed_at: string | null;
          offer_nudged_at: string | null;
          offer_status: string;
          offer_deposit_cents: number | null;
          offer_tuition_cents: number | null;
          waitlist_joined_at: string | null;
          waitlist_priority: string;
          waitlist_status: string;
          waitlist_last_contact_at: string | null;
          waitlist_unanswered_checkins: number;
          closed_reason: string | null;
          closed_at: string | null;
          keep_on_file: boolean;
          onboarding_steps: Json;
          stage_changed_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          classroom_id?: string | null;
          child_first_name?: string | null;
          child_last_name?: string | null;
          child_date_of_birth?: string | null;
          guardian_name?: string | null;
          guardian_email?: string | null;
          guardian_phone?: string | null;
          stage?: string;
          desired_start_date?: string | null;
          source?: string | null;
          notes?: string | null;
          waitlist_position?: number | null;
          schedule?: Json;
          application_data?: Json;
          documents_status?: Json;
          application_progress?: number;
          tour_at?: string | null;
          tour_host_id?: string | null;
          tour_outcome?: string | null;
          tour_notes?: string | null;
          offer_sent_at?: string | null;
          offer_expires_at?: string | null;
          offer_viewed_at?: string | null;
          offer_nudged_at?: string | null;
          offer_status?: string;
          offer_deposit_cents?: number | null;
          offer_tuition_cents?: number | null;
          waitlist_joined_at?: string | null;
          waitlist_priority?: string;
          waitlist_status?: string;
          waitlist_last_contact_at?: string | null;
          waitlist_unanswered_checkins?: number;
          closed_reason?: string | null;
          closed_at?: string | null;
          keep_on_file?: boolean;
          onboarding_steps?: Json;
        };
        Update: {
          child_id?: string | null;
          child_first_name?: string | null;
          child_last_name?: string | null;
          child_date_of_birth?: string | null;
          guardian_name?: string | null;
          guardian_email?: string | null;
          guardian_phone?: string | null;
          stage?: string;
          classroom_id?: string | null;
          desired_start_date?: string | null;
          source?: string | null;
          notes?: string | null;
          stage_changed_at?: string | null;
          waitlist_position?: number | null;
          schedule?: Json;
          application_data?: Json;
          documents_status?: Json;
          application_progress?: number;
          tour_at?: string | null;
          tour_host_id?: string | null;
          tour_outcome?: string | null;
          tour_notes?: string | null;
          offer_sent_at?: string | null;
          offer_expires_at?: string | null;
          offer_viewed_at?: string | null;
          offer_nudged_at?: string | null;
          offer_status?: string;
          offer_deposit_cents?: number | null;
          offer_tuition_cents?: number | null;
          waitlist_joined_at?: string | null;
          waitlist_priority?: string;
          waitlist_status?: string;
          waitlist_last_contact_at?: string | null;
          waitlist_unanswered_checkins?: number;
          closed_reason?: string | null;
          closed_at?: string | null;
          keep_on_file?: boolean;
          onboarding_steps?: Json;
        };
        Relationships: [];
      };
      enrollment_tour_slots: {
        Row: {
          id: string;
          daycare_id: string;
          starts_at: string;
          ends_at: string;
          classroom_id: string | null;
          host_id: string | null;
          enrollment_id: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          starts_at: string;
          ends_at: string;
          classroom_id?: string | null;
          host_id?: string | null;
          enrollment_id?: string | null;
          status?: string;
          created_by?: string | null;
        };
        Update: {
          starts_at?: string;
          ends_at?: string;
          classroom_id?: string | null;
          host_id?: string | null;
          enrollment_id?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      enrollment_settings: {
        Row: {
          daycare_id: string;
          siblings_first: boolean;
          staff_children_next: boolean;
          offer_window_hours: number;
          auto_offer: boolean;
          auto_archive_checkins: number;
          inquiry_reply_hours: number;
          updated_at: string;
        };
        Insert: {
          daycare_id: string;
          siblings_first?: boolean;
          staff_children_next?: boolean;
          offer_window_hours?: number;
          auto_offer?: boolean;
          auto_archive_checkins?: number;
          inquiry_reply_hours?: number;
        };
        Update: {
          siblings_first?: boolean;
          staff_children_next?: boolean;
          offer_window_hours?: number;
          auto_offer?: boolean;
          auto_archive_checkins?: number;
          inquiry_reply_hours?: number;
        };
        Relationships: [];
      };
      child_departures: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          last_day: string;
          reason: string;
          notes: string | null;
          offer_spot_automatically: boolean;
          status: string;
          scheduled_by: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          child_id: string;
          last_day: string;
          reason: string;
          notes?: string | null;
          offer_spot_automatically?: boolean;
          status?: string;
          scheduled_by?: string | null;
        };
        Update: {
          last_day?: string;
          reason?: string;
          notes?: string | null;
          offer_spot_automatically?: boolean;
          status?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          daycare_id: string;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          before: unknown;
          after: unknown;
          created_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      center_roles: {
        Row: {
          id: string;
          daycare_id: string;
          name: string;
          description: string | null;
          base_role: string;
          is_locked: boolean;
          is_system: boolean;
          sort: number;
          permissions: Json;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          name: string;
          description?: string | null;
          base_role: string;
          sort?: number;
          permissions?: Json;
        };
        Update: {
          name?: string;
          description?: string | null;
          sort?: number;
          permissions?: Json;
        };
        Relationships: [];
      };
      center_closures: {
        Row: {
          id: string;
          daycare_id: string;
          starts_on: string;
          ends_on: string;
          reason: string;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          starts_on: string;
          ends_on: string;
          reason: string;
        };
        Update: { starts_on?: string; ends_on?: string; reason?: string };
        Relationships: [];
      };
      billing_plans: {
        Row: {
          id: string;
          daycare_id: string;
          name: string;
          amount_cents: number;
          currency: string;
          cadence: string;
          active: boolean;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          name: string;
          amount_cents: number;
          cadence?: string;
          active?: boolean;
        };
        Update: { name?: string; amount_cents?: number; cadence?: string; active?: boolean };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          daycare_id: string;
          family_id: string | null;
          account_id: string | null;
          child_id: string | null;
          billed_to: string | null;
          number: string | null;
          status: string;
          issued_on: string | null;
          due_on: string | null;
          subtotal_cents: number;
          total_cents: number;
          currency: string;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          family_id?: string | null;
          account_id?: string | null;
          child_id?: string | null;
          billed_to?: string | null;
          number?: string | null;
          status?: string;
          due_on?: string | null;
        };
        Update: { status?: string; due_on?: string | null; account_id?: string | null };
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          id: string;
          daycare_id: string;
          invoice_id: string;
          billing_plan_id: string | null;
          description: string;
          quantity: number;
          unit_amount_cents: number;
          amount_cents: number;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          invoice_id: string;
          description: string;
          quantity?: number;
          unit_amount_cents?: number;
          amount_cents?: number;
        };
        Update: { description?: string };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          daycare_id: string;
          family_id: string | null;
          account_id: string | null;
          invoice_id: string | null;
          paid_by: string | null;
          amount_cents: number;
          currency: string;
          method: string | null;
          status: string;
          external_ref: string | null;
          paid_at: string | null;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          family_id?: string | null;
          account_id?: string | null;
          invoice_id?: string | null;
          paid_by?: string | null;
          amount_cents: number;
          method?: string | null;
          status?: string;
        };
        Update: { status?: string; account_id?: string | null };
        Relationships: [];
      };
      statements: {
        Row: {
          id: string;
          daycare_id: string;
          family_id: string | null;
          account_id: string | null;
          child_id: string | null;
          period_start: string;
          period_end: string;
          total_cents: number;
          storage_path: string | null;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          family_id?: string | null;
          account_id?: string | null;
          child_id?: string | null;
          period_start: string;
          period_end: string;
          total_cents?: number;
          storage_path?: string | null;
        };
        Update: {
          family_id?: string | null;
          account_id?: string | null;
          child_id?: string | null;
          total_cents?: number;
          storage_path?: string | null;
        };
        Relationships: [];
      };
      family_ledger_accounts: {
        Row: {
          id: string;
          daycare_id: string;
          family_id: string;
          currency: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          family_id: string;
          currency?: string;
          status?: string;
        };
        Update: { currency?: string; status?: string };
        Relationships: [];
      };
      family_ledger_entries: {
        Row: {
          id: string;
          daycare_id: string;
          account_id: string;
          family_id: string;
          entry_type: string;
          amount_cents: number;
          currency: string;
          description: string;
          source_invoice_id: string | null;
          source_payment_id: string | null;
          reverses_entry_id: string | null;
          effective_at: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          account_id: string;
          family_id: string;
          entry_type: string;
          amount_cents: number;
          currency?: string;
          description: string;
          source_invoice_id?: string | null;
          source_payment_id?: string | null;
          reverses_entry_id?: string | null;
          effective_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      payment_allocations: {
        Row: {
          payment_id: string;
          invoice_id: string;
          daycare_id: string;
          family_id: string;
          amount_cents: number;
          created_at: string;
        };
        Insert: {
          payment_id: string;
          invoice_id: string;
          daycare_id: string;
          family_id: string;
          amount_cents: number;
        };
        Update: { amount_cents?: number };
        Relationships: [];
      };
      consents: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string;
          parent_id: string | null;
          kind: string;
          version: string;
          granted: boolean;
          granted_at: string | null;
          revoked_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          child_id: string;
          parent_id?: string | null;
          kind: string;
          version?: string;
          granted?: boolean;
          granted_at?: string | null;
        };
        Update: { granted?: boolean; granted_at?: string | null; revoked_at?: string | null };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          daycare_id: string;
          profile_id: string;
          kind: string;
          title: string;
          body: string | null;
          payload: Json | null;
          read_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          daycare_id: string;
          profile_id: string;
          kind: string;
          title: string;
          body?: string | null;
          payload?: Json | null;
          read_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          read_at?: string | null;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          profile_id: string;
          daycare_id: string;
          kind: string;
          in_app: boolean;
          push: boolean;
          email: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          daycare_id: string;
          kind: string;
          in_app?: boolean;
          push?: boolean;
          email?: boolean;
        };
        Update: {
          in_app?: boolean;
          push?: boolean;
          email?: boolean;
        };
        Relationships: [];
      };
      notification_delivery_settings: {
        Row: {
          profile_id: string;
          daycare_id: string;
          quiet_hours_enabled: boolean;
          quiet_hours_start: string;
          quiet_hours_end: string;
          email_mode: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          daycare_id: string;
          quiet_hours_enabled?: boolean;
          quiet_hours_start?: string;
          quiet_hours_end?: string;
          email_mode?: string;
        };
        Update: {
          quiet_hours_enabled?: boolean;
          quiet_hours_start?: string;
          quiet_hours_end?: string;
          email_mode?: string;
        };
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          id: string;
          daycare_id: string;
          recipient_id: string | null;
          recipient_email: string | null;
          channel: string;
          kind: string;
          title: string;
          body: string | null;
          payload: Json;
          status: string;
          dedupe_key: string;
          attempts: number;
          max_attempts: number;
          available_at: string;
          locked_at: string | null;
          delivered_at: string | null;
          last_error: string | null;
          provider_response: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      list_my_daycare_locations: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          group_name: string;
          location_label: string;
          address: string | null;
          color: string;
          checked_in_count: number;
          is_active: boolean;
        }[];
      };
      switch_daycare_location: {
        Args: { p_daycare_id: string };
        Returns: undefined;
      };
      create_daycare_location: {
        Args: { p_location_label: string; p_address?: string | null; p_color?: string };
        Returns: string;
      };
      get_my_role: { Args: Record<string, never>; Returns: string };
      get_my_daycare_id: { Args: Record<string, never>; Returns: string };
      my_family_ids: { Args: Record<string, never>; Returns: string[] };
      can_access_family: { Args: { p_family_id: string }; Returns: boolean };
      can_message_family: { Args: { p_family_id: string }; Returns: boolean };
      shares_family_with: { Args: { p_profile_id: string }; Returns: boolean };
      has_permission: {
        Args: { p_area: string; p_action?: string };
        Returns: boolean;
      };
      can_access_child_area: {
        Args: { p_child_id: string; p_area: string; p_action?: string };
        Returns: boolean;
      };
      can_access_billing_family: {
        Args: { p_family_id: string; p_action?: string };
        Returns: boolean;
      };
      enqueue_child_notification: {
        Args: {
          p_child_id: string;
          p_kind: string;
          p_title: string;
          p_body?: string | null;
          p_payload?: Json;
          p_dedupe_key?: string | null;
          p_channels?: string[];
        };
        Returns: number;
      };
      enqueue_center_notification: {
        Args: {
          p_daycare_id: string;
          p_classroom_id: string | null;
          p_kind: string;
          p_title: string;
          p_body?: string | null;
          p_payload?: Json;
          p_dedupe_key?: string | null;
          p_channels?: string[];
        };
        Returns: number;
      };
      enqueue_email_notification: {
        Args: {
          p_daycare_id: string;
          p_recipient_email: string;
          p_kind: string;
          p_title: string;
          p_body?: string | null;
          p_payload?: Json;
          p_dedupe_key?: string | null;
        };
        Returns: string | null;
      };
      process_due_child_departures: {
        Args: Record<string, never>;
        Returns: number;
      };
      clock_in: {
        Args: { p_classroom_id?: string | null; p_at?: string };
        Returns: string;
      };
      clock_out: {
        Args: { p_at?: string; p_break_minutes?: number };
        Returns: string;
      };
      approve_time_entry: {
        Args: { p_entry_id: string; p_approved: boolean; p_notes?: string | null };
        Returns: undefined;
      };
      get_family_ledger_balance: {
        Args: { p_family_id: string };
        Returns: number;
      };
      create_ledger_adjustment: {
        Args: {
          p_family_id: string;
          p_amount_cents: number;
          p_description: string;
          p_entry_type?: string;
        };
        Returns: string;
      };
      get_daycare_classrooms: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          age_group: string | null;
          child_count: number;
        }[];
      };
      get_staff_invite: {
        Args: { p_code: string };
        Returns: {
          email: string;
          full_name: string | null;
          role: string;
          daycare_name: string;
          classroom_name: string | null;
          invited_by_name: string | null;
          expires_at: string | null;
        }[];
      };
      accept_staff_invite: { Args: { p_code: string }; Returns: undefined };
      start_center: { Args: { p_center_name: string }; Returns: string };
      create_parent_invite: {
        Args: { p_child_id: string; p_email: string; p_relationship?: string | null };
        Returns: string;
      };
      get_rooms_live_status: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          age_group: string | null;
          min_age_months: number | null;
          max_age_months: number | null;
          capacity: number | null;
          ratio_children_per_educator: number | null;
          enrolled_count: number;
          present_count: number;
          last_log_at: string | null;
          educators: { id: string; full_name: string }[];
        }[];
      };
      get_public_center_info: {
        Args: { p_daycare_id: string };
        Returns: { name: string; programs: { id: string; name: string }[] }[];
      };
      submit_enrollment_inquiry: {
        Args: {
          p_daycare_id: string;
          p_guardian_name: string;
          p_guardian_email: string;
          p_guardian_phone?: string | null;
          p_child_first_name?: string | null;
          p_child_date_of_birth?: string | null;
          p_classroom_id?: string | null;
          p_desired_start?: string | null;
        };
        Returns: undefined;
      };
      submit_enrollment_inquiry_v2: {
        Args: {
          p_daycare_id: string;
          p_guardian_name: string;
          p_guardian_email: string;
          p_guardian_phone: string | null;
          p_child_first_name: string;
          p_child_date_of_birth: string | null;
          p_classroom_id: string | null;
          p_desired_start: string | null;
          p_days_per_week: number;
        };
        Returns: string;
      };
      enroll_from_pipeline: {
        Args: { p_enrollment_id: string; p_classroom_id: string; p_last_name?: string | null };
        Returns: string;
      };
      create_invoice: {
        Args: {
          p_child_id: string | null;
          p_billed_to: string | null;
          p_due_on: string;
          p_lines: unknown;
        };
        Returns: string;
      };
      record_invoice_payment: {
        Args: { p_invoice_id: string; p_amount_cents: number; p_method?: string };
        Returns: string;
      };
      get_billing_summary: {
        Args: Record<string, never>;
        Returns: {
          collected_month_cents: number;
          expected_month_cents: number;
          outstanding_cents: number;
          overdue_count: number;
          open_count: number;
        }[];
      };
      get_inbox_threads: {
        Args: Record<string, never>;
        Returns: {
          conversation_id: string;
          family_id: string | null;
          family_name: string;
          family_child_count: number;
          child_id: string;
          child_first_name: string;
          child_last_name: string;
          room_name: string | null;
          last_message_at: string | null;
          last_message_body: string | null;
          last_message_from_staff: boolean;
          unread_count: number;
        }[];
      };
      mark_messages_read: { Args: { p_child_id: string }; Returns: undefined };
      get_nav_badges: {
        Args: Record<string, never>;
        Returns: { overdue_invoices: number; cert_issues: number }[];
      };
      get_center_roles: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          description: string | null;
          base_role: string;
          is_locked: boolean;
          is_system: boolean;
          sort: number;
          permissions: Json;
          member_count: number;
        }[];
      };
      get_staff_delegations: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          delegate_profile_id: string;
          delegate_name: string;
          delegate_role: string;
          classroom_name: string | null;
          access_level: string;
          areas: string[];
          starts_at: string;
          ends_at: string;
          granted_by_name: string;
          revoked_at: string | null;
          revoked_by_name: string | null;
          action_count: number;
        }[];
      };
      grant_staff_delegation: {
        Args: {
          p_delegate_profile_id: string;
          p_access_level: string;
          p_areas: string[];
          p_ends_at: string;
        };
        Returns: string;
      };
      revoke_staff_delegation: {
        Args: { p_delegation_id: string };
        Returns: undefined;
      };
      create_pickup: {
        Args: {
          p_child_id: string;
          p_full_name: string;
          p_relationship?: string | null;
          p_phone?: string | null;
        };
        Returns: string;
      };
      get_attendance_week: {
        Args: Record<string, never>;
        Returns: { day: string; present_count: number; absent_count: number }[];
      };
      kiosk_lookup_pin: {
        Args: { p_pin: string };
        Returns: {
          pickup_name: string;
          child_id: string;
          first_name: string;
          last_name: string;
          room_name: string | null;
          checked_in_at: string | null;
          checked_out_at: string | null;
        }[];
      };
      kiosk_check: {
        Args: { p_child_id: string; p_pin: string };
        Returns: string;
      };
      get_room_transitions: {
        Args: { p_horizon_months?: number };
        Returns: {
          child_id: string;
          first_name: string;
          last_name: string;
          date_of_birth: string | null;
          age_months: number;
          room_id: string;
          room_name: string;
          max_age_months: number;
          next_room_id: string | null;
          next_room_name: string | null;
        }[];
      };
      invite_staff: {
        Args: {
          p_email: string;
          p_role: string;
          p_classroom_id?: string | null;
          p_full_name?: string | null;
          p_job_title?: string | null;
          p_require_background_check?: boolean;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
