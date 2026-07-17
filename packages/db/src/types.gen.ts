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
        };
        Update: {
          name?: string;
          address?: string | null;
          phone?: string | null;
          active?: boolean;
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
        };
        Update: {
          name?: string;
          age_group?: string | null;
          min_age_months?: number | null;
          max_age_months?: number | null;
          capacity?: number | null;
          ratio_children_per_educator?: number | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: string;
          daycare_id: string | null;
          classroom_id: string | null;
          phone: string | null;
          avatar_url: string | null;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role: string;
          daycare_id?: string | null;
          classroom_id?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          avatar_url?: string | null;
          classroom_id?: string | null;
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
          daycare_id: string;
          child_id: string;
          code: string;
          email?: string | null;
          relationship?: string | null;
          expires_at?: string | null;
        };
        Update: { used_at?: string | null };
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
          daycare_id: string;
          child_id: string;
          parent_id?: string | null;
          name: string;
          dosage: string;
          schedule?: string | null;
          notes?: string | null;
        };
        Update: { active?: boolean; end_date?: string | null };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          daycare_id: string;
          child_id: string | null;
          subject: string | null;
          kind: string;
          last_message_at: string | null;
          archived_at: string | null;
          created_at: string | null;
        };
        Insert: {
          daycare_id: string;
          child_id?: string | null;
          subject?: string | null;
          kind?: string;
        };
        Update: { archived_at?: string | null };
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
          stage_changed_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          daycare_id: string;
          classroom_id?: string | null;
          child_first_name?: string | null;
          child_date_of_birth?: string | null;
          guardian_name?: string | null;
          guardian_email?: string | null;
          guardian_phone?: string | null;
          stage?: string;
          desired_start_date?: string | null;
          source?: string | null;
          notes?: string | null;
        };
        Update: {
          stage?: string;
          classroom_id?: string | null;
          notes?: string | null;
          stage_changed_at?: string | null;
          waitlist_position?: number | null;
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
          child_id?: string | null;
          billed_to?: string | null;
          number?: string | null;
          status?: string;
          due_on?: string | null;
        };
        Update: { status?: string; due_on?: string | null };
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
          invoice_id?: string | null;
          paid_by?: string | null;
          amount_cents: number;
          method?: string | null;
          status?: string;
        };
        Update: { status?: string };
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
          kind: string;
          version?: string;
          granted?: boolean;
        };
        Update: { granted?: boolean; granted_at?: string | null; revoked_at?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_my_role: { Args: Record<string, never>; Returns: string };
      get_my_daycare_id: { Args: Record<string, never>; Returns: string };
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
