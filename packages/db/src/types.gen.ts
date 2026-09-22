export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_entries: {
        Row: {
          activity_name: string
          created_at: string | null
          daily_log_id: string
          id: string
        }
        Insert: {
          activity_name: string
          created_at?: string | null
          daily_log_id: string
          id?: string
        }
        Update: {
          activity_name?: string
          created_at?: string | null
          daily_log_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_entries_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          announcement_id: string
          profile_id: string
          read_at?: string
        }
        Update: {
          announcement_id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_rsvps: {
        Row: {
          announcement_id: string
          child_id: string | null
          created_at: string | null
          daycare_id: string
          guests: number | null
          id: string
          profile_id: string
          response: string
          updated_at: string | null
        }
        Insert: {
          announcement_id: string
          child_id?: string | null
          created_at?: string | null
          daycare_id: string
          guests?: number | null
          id?: string
          profile_id: string
          response: string
          updated_at?: string | null
        }
        Update: {
          announcement_id?: string
          child_id?: string | null
          created_at?: string | null
          daycare_id?: string
          guests?: number | null
          id?: string
          profile_id?: string
          response?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcement_rsvps_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_rsvps_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_rsvps_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_rsvps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          author_id: string | null
          body: string
          classroom_id: string | null
          created_at: string | null
          daycare_id: string
          event_at: string | null
          event_ends_at: string | null
          event_location: string | null
          id: string
          pinned: boolean | null
          rsvp_enabled: boolean
          title: string
          updated_at: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          classroom_id?: string | null
          created_at?: string | null
          daycare_id: string
          event_at?: string | null
          event_ends_at?: string | null
          event_location?: string | null
          id?: string
          pinned?: boolean | null
          rsvp_enabled?: boolean
          title: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          classroom_id?: string | null
          created_at?: string | null
          daycare_id?: string
          event_at?: string | null
          event_ends_at?: string | null
          event_location?: string | null
          id?: string
          pinned?: boolean | null
          rsvp_enabled?: boolean
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      attendance_corrections: {
        Row: {
          attendance_id: string
          corrected_at: string
          corrected_by: string
          corrected_checked_in_at: string | null
          corrected_checked_out_at: string | null
          daycare_id: string
          id: string
          previous_checked_in_at: string | null
          previous_checked_out_at: string | null
          reason: string
          source: string
        }
        Insert: {
          attendance_id: string
          corrected_at?: string
          corrected_by: string
          corrected_checked_in_at?: string | null
          corrected_checked_out_at?: string | null
          daycare_id: string
          id?: string
          previous_checked_in_at?: string | null
          previous_checked_out_at?: string | null
          reason: string
          source: string
        }
        Update: {
          attendance_id?: string
          corrected_at?: string
          corrected_by?: string
          corrected_checked_in_at?: string | null
          corrected_checked_out_at?: string | null
          daycare_id?: string
          id?: string
          previous_checked_in_at?: string | null
          previous_checked_out_at?: string | null
          reason?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_corrections_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_followups: {
        Row: {
          attendance_date: string
          child_id: string
          daycare_id: string
          escalation_due_at: string | null
          id: string
          message: string
          queued_recipients: number
          resolution: string | null
          resolved_at: string | null
          sent_at: string
          sent_by: string
        }
        Insert: {
          attendance_date: string
          child_id: string
          daycare_id: string
          escalation_due_at?: string | null
          id?: string
          message: string
          queued_recipients?: number
          resolution?: string | null
          resolved_at?: string | null
          sent_at?: string
          sent_by: string
        }
        Update: {
          attendance_date?: string
          child_id?: string
          daycare_id?: string
          escalation_due_at?: string | null
          id?: string
          message?: string
          queued_recipients?: number
          resolution?: string | null
          resolved_at?: string | null
          sent_at?: string
          sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_followups_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_followups_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_followups_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          absence_reason: string | null
          absence_report_id: string | null
          absence_reported_at: string | null
          absence_reported_by: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          child_id: string
          created_at: string | null
          date: string
          daycare_id: string
          dropped_off_by: string | null
          id: string
          method: string | null
          notes: string | null
          picked_up_by: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          absence_reason?: string | null
          absence_report_id?: string | null
          absence_reported_at?: string | null
          absence_reported_by?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          child_id: string
          created_at?: string | null
          date?: string
          daycare_id: string
          dropped_off_by?: string | null
          id?: string
          method?: string | null
          notes?: string | null
          picked_up_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          absence_reason?: string | null
          absence_report_id?: string | null
          absence_reported_at?: string | null
          absence_reported_by?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          child_id?: string
          created_at?: string | null
          date?: string
          daycare_id?: string
          dropped_off_by?: string | null
          id?: string
          method?: string | null
          notes?: string | null
          picked_up_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_absence_report_id_fkey"
            columns: ["absence_report_id"]
            isOneToOne: false
            referencedRelation: "parent_absence_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_absence_reported_by_fkey"
            columns: ["absence_reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_checked_out_by_fkey"
            columns: ["checked_out_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string | null
          daycare_id: string
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string | null
          daycare_id: string
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string | null
          daycare_id?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          active: boolean
          amount_cents: number
          cadence: string
          created_at: string | null
          currency: string
          daycare_id: string
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          amount_cents: number
          cadence?: string
          created_at?: string | null
          currency?: string
          daycare_id: string
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          amount_cents?: number
          cadence?: string
          created_at?: string | null
          currency?: string
          daycare_id?: string
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_plans_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      center_closures: {
        Row: {
          billing_treatment: string
          created_at: string | null
          daycare_id: string
          ends_on: string
          family_message: string | null
          family_visible: boolean
          id: string
          published_at: string | null
          reason: string
          reminder_days_before: number
          starts_on: string
          updated_at: string
        }
        Insert: {
          billing_treatment?: string
          created_at?: string | null
          daycare_id: string
          ends_on: string
          family_message?: string | null
          family_visible?: boolean
          id?: string
          published_at?: string | null
          reason: string
          reminder_days_before?: number
          starts_on: string
          updated_at?: string
        }
        Update: {
          billing_treatment?: string
          created_at?: string | null
          daycare_id?: string
          ends_on?: string
          family_message?: string | null
          family_visible?: boolean
          id?: string
          published_at?: string | null
          reason?: string
          reminder_days_before?: number
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "center_closures_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      center_registration_codes: {
        Row: {
          admin_email: string
          center_name: string
          code_hash: string
          code_suffix: string
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          daycare_id: string | null
          expires_at: string
          id: string
          revoked_at: string | null
        }
        Insert: {
          admin_email: string
          center_name: string
          code_hash: string
          code_suffix: string
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          daycare_id?: string | null
          expires_at: string
          id?: string
          revoked_at?: string | null
        }
        Update: {
          admin_email?: string
          center_name?: string
          code_hash?: string
          code_suffix?: string
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          daycare_id?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "center_registration_codes_consumed_by_fkey"
            columns: ["consumed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "center_registration_codes_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      center_roles: {
        Row: {
          base_role: string
          created_at: string | null
          daycare_id: string
          description: string | null
          id: string
          is_locked: boolean
          is_system: boolean
          name: string
          permissions: Json
          sort: number
          updated_at: string | null
        }
        Insert: {
          base_role: string
          created_at?: string | null
          daycare_id: string
          description?: string | null
          id?: string
          is_locked?: boolean
          is_system?: boolean
          name: string
          permissions?: Json
          sort?: number
          updated_at?: string | null
        }
        Update: {
          base_role?: string
          created_at?: string | null
          daycare_id?: string
          description?: string | null
          id?: string
          is_locked?: boolean
          is_system?: boolean
          name?: string
          permissions?: Json
          sort?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "center_roles_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      child_attendance_bookings: {
        Row: {
          arrives_at: string | null
          booked_on: string
          child_id: string
          daycare_id: string
          expected: boolean
          leaves_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          arrives_at?: string | null
          booked_on: string
          child_id: string
          daycare_id: string
          expected: boolean
          leaves_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          arrives_at?: string | null
          booked_on?: string
          child_id?: string
          daycare_id?: string
          expected?: boolean
          leaves_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_attendance_bookings_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_attendance_bookings_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_attendance_bookings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_departures: {
        Row: {
          child_id: string
          completed_at: string | null
          created_at: string
          daycare_id: string
          id: string
          last_day: string
          notes: string | null
          offer_spot_automatically: boolean
          reason: string
          scheduled_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          child_id: string
          completed_at?: string | null
          created_at?: string
          daycare_id: string
          id?: string
          last_day: string
          notes?: string | null
          offer_spot_automatically?: boolean
          reason: string
          scheduled_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          child_id?: string
          completed_at?: string | null
          created_at?: string
          daycare_id?: string
          id?: string
          last_day?: string
          notes?: string | null
          offer_spot_automatically?: boolean
          reason?: string
          scheduled_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_departures_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_departures_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_departures_scheduled_by_fkey"
            columns: ["scheduled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_invite_codes: {
        Row: {
          child_id: string
          code: string
          created_at: string | null
          created_by: string | null
          daycare_id: string
          email: string | null
          expires_at: string | null
          id: string
          relationship: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          child_id: string
          code: string
          created_at?: string | null
          created_by?: string | null
          daycare_id: string
          email?: string | null
          expires_at?: string | null
          id?: string
          relationship?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          child_id?: string
          code?: string
          created_at?: string | null
          created_by?: string | null
          daycare_id?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          relationship?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_invite_codes_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_invite_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_invite_codes_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_invite_codes_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_pickups: {
        Row: {
          approval_status: string
          archived_at: string | null
          child_id: string
          created_at: string | null
          created_by: string | null
          daycare_id: string
          full_name: string
          id: string
          is_primary: boolean
          phone: string | null
          pin: string
          relationship: string | null
          requested_at: string | null
          requested_by: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string | null
        }
        Insert: {
          approval_status?: string
          archived_at?: string | null
          child_id: string
          created_at?: string | null
          created_by?: string | null
          daycare_id: string
          full_name: string
          id?: string
          is_primary?: boolean
          phone?: string | null
          pin: string
          relationship?: string | null
          requested_at?: string | null
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_status?: string
          archived_at?: string | null
          child_id?: string
          created_at?: string | null
          created_by?: string | null
          daycare_id?: string
          full_name?: string
          id?: string
          is_primary?: boolean
          phone?: string | null
          pin?: string
          relationship?: string | null
          requested_at?: string | null
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_pickups_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_pickups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_pickups_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_pickups_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_pickups_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_tuition_rates: {
        Row: {
          amount_cents: number
          child_id: string
          classroom_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          daycare_id: string
          effective_from: string
          effective_to: string | null
          id: string
          source_enrollment_id: string | null
          source_transition_plan_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          child_id: string
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          daycare_id: string
          effective_from: string
          effective_to?: string | null
          id?: string
          source_enrollment_id?: string | null
          source_transition_plan_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          child_id?: string
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          daycare_id?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          source_enrollment_id?: string | null
          source_transition_plan_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_tuition_rates_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_tuition_rates_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_tuition_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_tuition_rates_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_tuition_rates_source_enrollment_id_fkey"
            columns: ["source_enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_tuition_rates_source_transition_plan_id_fkey"
            columns: ["source_transition_plan_id"]
            isOneToOne: true
            referencedRelation: "room_transition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          allergies: string[] | null
          archived_at: string | null
          classroom_id: string | null
          created_at: string | null
          date_of_birth: string | null
          daycare_id: string
          dietary_needs: string | null
          emergency_contacts: Json | null
          enrolled_on: string | null
          first_name: string
          home_address: string | null
          id: string
          last_name: string
          medical_notes: string | null
          photo_url: string | null
          preferred_name: string | null
          pronouns: string | null
          setup_state: Json | null
          updated_at: string | null
        }
        Insert: {
          allergies?: string[] | null
          archived_at?: string | null
          classroom_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          daycare_id: string
          dietary_needs?: string | null
          emergency_contacts?: Json | null
          enrolled_on?: string | null
          first_name: string
          home_address?: string | null
          id?: string
          last_name: string
          medical_notes?: string | null
          photo_url?: string | null
          preferred_name?: string | null
          pronouns?: string | null
          setup_state?: Json | null
          updated_at?: string | null
        }
        Update: {
          allergies?: string[] | null
          archived_at?: string | null
          classroom_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          daycare_id?: string
          dietary_needs?: string | null
          emergency_contacts?: Json | null
          enrolled_on?: string | null
          first_name?: string
          home_address?: string | null
          id?: string
          last_name?: string
          medical_notes?: string | null
          photo_url?: string | null
          preferred_name?: string | null
          pronouns?: string | null
          setup_state?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "children_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "children_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      classrooms: {
        Row: {
          age_group: string | null
          archived_at: string | null
          capacity: number | null
          created_at: string | null
          daycare_id: string
          id: string
          lead_educator_id: string | null
          max_age_months: number | null
          min_age_months: number | null
          name: string
          nap_end: string | null
          nap_start: string | null
          opens_on: string | null
          ratio_children_per_educator: number | null
          updated_at: string | null
        }
        Insert: {
          age_group?: string | null
          archived_at?: string | null
          capacity?: number | null
          created_at?: string | null
          daycare_id: string
          id?: string
          lead_educator_id?: string | null
          max_age_months?: number | null
          min_age_months?: number | null
          name: string
          nap_end?: string | null
          nap_start?: string | null
          opens_on?: string | null
          ratio_children_per_educator?: number | null
          updated_at?: string | null
        }
        Update: {
          age_group?: string | null
          archived_at?: string | null
          capacity?: number | null
          created_at?: string | null
          daycare_id?: string
          id?: string
          lead_educator_id?: string | null
          max_age_months?: number | null
          min_age_months?: number | null
          name?: string
          nap_end?: string | null
          nap_start?: string | null
          opens_on?: string | null
          ratio_children_per_educator?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classrooms_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classrooms_lead_educator_id_fkey"
            columns: ["lead_educator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_documents: {
        Row: {
          category: string
          created_at: string
          daycare_id: string
          expires_on: string | null
          id: string
          include_in_inspection: boolean
          mime_type: string
          replaces_id: string | null
          size_bytes: number
          storage_path: string
          title: string
          uploaded_by: string
          version: number
          watch_expiry: boolean
        }
        Insert: {
          category: string
          created_at?: string
          daycare_id: string
          expires_on?: string | null
          id?: string
          include_in_inspection?: boolean
          mime_type: string
          replaces_id?: string | null
          size_bytes: number
          storage_path: string
          title: string
          uploaded_by: string
          version?: number
          watch_expiry?: boolean
        }
        Update: {
          category?: string
          created_at?: string
          daycare_id?: string
          expires_on?: string | null
          id?: string
          include_in_inspection?: boolean
          mime_type?: string
          replaces_id?: string | null
          size_bytes?: number
          storage_path?: string
          title?: string
          uploaded_by?: string
          version?: number
          watch_expiry?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "compliance_documents_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_documents_replaces_id_fkey"
            columns: ["replaces_id"]
            isOneToOne: true
            referencedRelation: "compliance_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_drills: {
        Row: {
          attendance_children: number
          attendance_staff: number
          children_count: number
          conducted_at: string
          created_at: string
          created_by: string
          daycare_id: string
          duration_seconds: number
          id: string
          kind: string
          lead_staff_id: string
          next_due_on: string | null
          notes: string
          staff_count: number
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          attendance_children: number
          attendance_staff: number
          children_count: number
          conducted_at: string
          created_at?: string
          created_by: string
          daycare_id: string
          duration_seconds: number
          id?: string
          kind: string
          lead_staff_id: string
          next_due_on?: string | null
          notes?: string
          staff_count: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          attendance_children?: number
          attendance_staff?: number
          children_count?: number
          conducted_at?: string
          created_at?: string
          created_by?: string
          daycare_id?: string
          duration_seconds?: number
          id?: string
          kind?: string
          lead_staff_id?: string
          next_due_on?: string | null
          notes?: string
          staff_count?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_drills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_drills_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_drills_lead_staff_id_fkey"
            columns: ["lead_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_inspection_shares: {
        Row: {
          created_at: string
          created_by: string
          daycare_id: string
          expires_at: string
          id: string
          label: string
          last_opened_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          daycare_id: string
          expires_at?: string
          id?: string
          label: string
          last_opened_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          daycare_id?: string
          expires_at?: string
          id?: string
          label?: string
          last_opened_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_inspection_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_inspection_shares_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          child_id: string
          created_at: string | null
          daycare_id: string
          granted: boolean
          granted_at: string | null
          id: string
          kind: string
          parent_id: string | null
          revoked_at: string | null
          updated_at: string | null
          version: string
        }
        Insert: {
          child_id: string
          created_at?: string | null
          daycare_id: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          kind: string
          parent_id?: string | null
          revoked_at?: string | null
          updated_at?: string | null
          version?: string
        }
        Update: {
          child_id?: string
          created_at?: string | null
          daycare_id?: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          kind?: string
          parent_id?: string | null
          revoked_at?: string | null
          updated_at?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          profile_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          profile_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          child_id: string | null
          created_at: string | null
          daycare_id: string
          family_id: string | null
          id: string
          kind: string
          last_message_at: string | null
          subject: string | null
        }
        Insert: {
          archived_at?: string | null
          child_id?: string | null
          created_at?: string | null
          daycare_id: string
          family_id?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          subject?: string | null
        }
        Update: {
          archived_at?: string | null
          child_id?: string | null
          created_at?: string | null
          daycare_id?: string
          family_id?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          child_id: string
          comments: string | null
          created_at: string | null
          daycare_id: string
          educator_id: string | null
          id: string
          log_date: string
          moods: string[] | null
          notes: string | null
          sent_at: string | null
          sent_to_parents: boolean | null
          updated_at: string | null
        }
        Insert: {
          child_id: string
          comments?: string | null
          created_at?: string | null
          daycare_id: string
          educator_id?: string | null
          id?: string
          log_date?: string
          moods?: string[] | null
          notes?: string | null
          sent_at?: string | null
          sent_to_parents?: boolean | null
          updated_at?: string | null
        }
        Update: {
          child_id?: string
          comments?: string | null
          created_at?: string | null
          daycare_id?: string
          educator_id?: string | null
          id?: string
          log_date?: string
          moods?: string[] | null
          notes?: string | null
          sent_at?: string | null
          sent_to_parents?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_educator_id_fkey"
            columns: ["educator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daycare_signup_codes: {
        Row: {
          code: string
          created_at: string | null
          daycare_id: string
          expires_at: string | null
          id: string
          role: string
          uses_remaining: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          daycare_id: string
          expires_at?: string | null
          id?: string
          role?: string
          uses_remaining?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          daycare_id?: string
          expires_at?: string | null
          id?: string
          role?: string
          uses_remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daycare_signup_codes_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      daycares: {
        Row: {
          active: boolean
          address: string | null
          closes_at: string
          created_at: string | null
          created_by: string | null
          default_delegation_days: number
          id: string
          license_number: string | null
          licensed_capacity: number
          name: string
          opens_at: string
          phone: string | null
          photo_consent_required: boolean
          pickup_id_check_required: boolean
          ratio_alert_after_minutes: number
          ratio_block_checkins: boolean
          ratio_ledger_started_at: string
          ratio_notify_floaters: boolean
          require_admin_mfa: boolean
          sick_return_hours: number
          time_tracking_enabled: boolean
          timezone: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          closes_at?: string
          created_at?: string | null
          created_by?: string | null
          default_delegation_days?: number
          id?: string
          license_number?: string | null
          licensed_capacity?: number
          name: string
          opens_at?: string
          phone?: string | null
          photo_consent_required?: boolean
          pickup_id_check_required?: boolean
          ratio_alert_after_minutes?: number
          ratio_block_checkins?: boolean
          ratio_ledger_started_at?: string
          ratio_notify_floaters?: boolean
          require_admin_mfa?: boolean
          sick_return_hours?: number
          time_tracking_enabled?: boolean
          timezone?: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          closes_at?: string
          created_at?: string | null
          created_by?: string | null
          default_delegation_days?: number
          id?: string
          license_number?: string | null
          licensed_capacity?: number
          name?: string
          opens_at?: string
          phone?: string | null
          photo_consent_required?: boolean
          pickup_id_check_required?: boolean
          ratio_alert_after_minutes?: number
          ratio_block_checkins?: boolean
          ratio_ledger_started_at?: string
          ratio_notify_floaters?: boolean
          require_admin_mfa?: boolean
          sick_return_hours?: number
          time_tracking_enabled?: boolean
          timezone?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      diaper_entries: {
        Row: {
          bm: boolean | null
          created_at: string | null
          daily_log_id: string
          id: string
          time: string
          type: string
          wet: boolean | null
        }
        Insert: {
          bm?: boolean | null
          created_at?: string | null
          daily_log_id: string
          id?: string
          time: string
          type: string
          wet?: boolean | null
        }
        Update: {
          bm?: boolean | null
          created_at?: string | null
          daily_log_id?: string
          id?: string
          time?: string
          type?: string
          wet?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "diaper_entries_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          archived_at: string | null
          category: string | null
          child_id: string | null
          created_at: string | null
          daycare_id: string
          expires_on: string | null
          id: string
          mime_type: string | null
          profile_id: string | null
          size_bytes: number | null
          storage_path: string
          title: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          child_id?: string | null
          created_at?: string | null
          daycare_id: string
          expires_on?: string | null
          id?: string
          mime_type?: string | null
          profile_id?: string | null
          size_bytes?: number | null
          storage_path: string
          title: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          child_id?: string | null
          created_at?: string | null
          daycare_id?: string
          expires_on?: string | null
          id?: string
          mime_type?: string | null
          profile_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          title?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      educator_classrooms: {
        Row: {
          classroom_id: string
          created_at: string | null
          educator_id: string
        }
        Insert: {
          classroom_id: string
          created_at?: string | null
          educator_id: string
        }
        Update: {
          classroom_id?: string
          created_at?: string | null
          educator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "educator_classrooms_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "educator_classrooms_educator_id_fkey"
            columns: ["educator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_agreement_signatures: {
        Row: {
          application_snapshot: Json
          created_at: string
          daycare_id: string
          enrollment_id: string
          id: string
          photo_consent: boolean
          signature_name: string
          signed_at: string
          signed_ip: string | null
          terms_snapshot: Json
          user_agent: string | null
          version: string
        }
        Insert: {
          application_snapshot?: Json
          created_at?: string
          daycare_id: string
          enrollment_id: string
          id?: string
          photo_consent?: boolean
          signature_name: string
          signed_at?: string
          signed_ip?: string | null
          terms_snapshot: Json
          user_agent?: string | null
          version: string
        }
        Update: {
          application_snapshot?: Json
          created_at?: string
          daycare_id?: string
          enrollment_id?: string
          id?: string
          photo_consent?: boolean
          signature_name?: string
          signed_at?: string
          signed_ip?: string | null
          terms_snapshot?: Json
          user_agent?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_agreement_signatures_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_agreement_signatures_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_application_documents: {
        Row: {
          created_at: string
          daycare_id: string
          enrollment_id: string
          file_name: string
          file_size: number
          id: string
          kind: string
          mime_type: string
          status: string
          storage_path: string
          uploaded_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          daycare_id: string
          enrollment_id: string
          file_name: string
          file_size: number
          id?: string
          kind: string
          mime_type: string
          status?: string
          storage_path: string
          uploaded_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          daycare_id?: string
          enrollment_id?: string
          file_name?: string
          file_size?: number
          id?: string
          kind?: string
          mime_type?: string
          status?: string
          storage_path?: string
          uploaded_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_application_documents_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_application_documents_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_application_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_billing_schedules: {
        Row: {
          amount_cents: number
          anchor_day: number
          cadence: string
          child_id: string
          created_at: string
          currency: string
          daycare_id: string
          enrollment_id: string
          family_id: string | null
          id: string
          last_invoice_id: string | null
          next_invoice_on: string
          remaining_credit_cents: number
          source_payment_id: string | null
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          anchor_day: number
          cadence?: string
          child_id: string
          created_at?: string
          currency?: string
          daycare_id: string
          enrollment_id: string
          family_id?: string | null
          id?: string
          last_invoice_id?: string | null
          next_invoice_on: string
          remaining_credit_cents?: number
          source_payment_id?: string | null
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          anchor_day?: number
          cadence?: string
          child_id?: string
          created_at?: string
          currency?: string
          daycare_id?: string
          enrollment_id?: string
          family_id?: string | null
          id?: string
          last_invoice_id?: string | null
          next_invoice_on?: string
          remaining_credit_cents?: number
          source_payment_id?: string | null
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_billing_schedules_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_billing_schedules_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_billing_schedules_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_billing_schedules_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_billing_schedules_last_invoice_id_fkey"
            columns: ["last_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_billing_schedules_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "enrollment_offer_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_offer_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          daycare_id: string
          enrollment_id: string
          id: string
          include_first_month: boolean
          provider: string
          provider_reference: string | null
          receipt_emailed_to: string | null
          receipt_number: string | null
          settled_at: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          daycare_id: string
          enrollment_id: string
          id?: string
          include_first_month?: boolean
          provider: string
          provider_reference?: string | null
          receipt_emailed_to?: string | null
          receipt_number?: string | null
          settled_at?: string | null
          status: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          daycare_id?: string
          enrollment_id?: string
          id?: string
          include_first_month?: boolean
          provider?: string
          provider_reference?: string | null
          receipt_emailed_to?: string | null
          receipt_number?: string | null
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_offer_payments_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_offer_payments_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_settings: {
        Row: {
          auto_archive_checkins: number
          auto_offer: boolean
          daycare_id: string
          inquiry_reply_hours: number
          offer_window_hours: number
          siblings_first: boolean
          staff_children_next: boolean
          updated_at: string
        }
        Insert: {
          auto_archive_checkins?: number
          auto_offer?: boolean
          daycare_id: string
          inquiry_reply_hours?: number
          offer_window_hours?: number
          siblings_first?: boolean
          staff_children_next?: boolean
          updated_at?: string
        }
        Update: {
          auto_archive_checkins?: number
          auto_offer?: boolean
          daycare_id?: string
          inquiry_reply_hours?: number
          offer_window_hours?: number
          siblings_first?: boolean
          staff_children_next?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_settings_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: true
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_tour_slots: {
        Row: {
          classroom_id: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          ends_at: string
          enrollment_id: string | null
          host_id: string | null
          id: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          ends_at: string
          enrollment_id?: string | null
          host_id?: string | null
          id?: string
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          ends_at?: string
          enrollment_id?: string | null
          host_id?: string | null
          id?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_tour_slots_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tour_slots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tour_slots_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tour_slots_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tour_slots_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          agreement_data: Json
          agreement_signed_at: string | null
          agreement_version: string | null
          application_data: Json
          application_progress: number
          application_submitted_at: string | null
          child_date_of_birth: string | null
          child_first_name: string | null
          child_id: string | null
          child_last_name: string | null
          classroom_id: string | null
          closed_at: string | null
          closed_reason: string | null
          created_at: string | null
          daycare_id: string
          deposit_paid_at: string | null
          deposit_payment_id: string | null
          deposit_status: string
          desired_start_date: string | null
          documents_status: Json
          guardian_email: string | null
          guardian_name: string | null
          guardian_phone: string | null
          id: string
          keep_on_file: boolean
          notes: string | null
          offer_accepted_at: string | null
          offer_code: string | null
          offer_decline_reason: string | null
          offer_declined_at: string | null
          offer_deposit_cents: number | null
          offer_expires_at: string | null
          offer_nudged_at: string | null
          offer_sent_at: string | null
          offer_status: string
          offer_tuition_cents: number | null
          offer_viewed_at: string | null
          onboarding_steps: Json
          parent_account_linked_at: string | null
          parent_workflow_step: string
          payment_mode: string
          schedule: Json
          source: string | null
          stage: string
          stage_changed_at: string | null
          tour_at: string | null
          tour_host_id: string | null
          tour_notes: string | null
          tour_outcome: string | null
          updated_at: string | null
          waitlist_joined_at: string | null
          waitlist_last_contact_at: string | null
          waitlist_last_response_at: string | null
          waitlist_position: number | null
          waitlist_priority: string
          waitlist_response_due_at: string | null
          waitlist_status: string
          waitlist_unanswered_checkins: number
        }
        Insert: {
          agreement_data?: Json
          agreement_signed_at?: string | null
          agreement_version?: string | null
          application_data?: Json
          application_progress?: number
          application_submitted_at?: string | null
          child_date_of_birth?: string | null
          child_first_name?: string | null
          child_id?: string | null
          child_last_name?: string | null
          classroom_id?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string | null
          daycare_id: string
          deposit_paid_at?: string | null
          deposit_payment_id?: string | null
          deposit_status?: string
          desired_start_date?: string | null
          documents_status?: Json
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          keep_on_file?: boolean
          notes?: string | null
          offer_accepted_at?: string | null
          offer_code?: string | null
          offer_decline_reason?: string | null
          offer_declined_at?: string | null
          offer_deposit_cents?: number | null
          offer_expires_at?: string | null
          offer_nudged_at?: string | null
          offer_sent_at?: string | null
          offer_status?: string
          offer_tuition_cents?: number | null
          offer_viewed_at?: string | null
          onboarding_steps?: Json
          parent_account_linked_at?: string | null
          parent_workflow_step?: string
          payment_mode?: string
          schedule?: Json
          source?: string | null
          stage?: string
          stage_changed_at?: string | null
          tour_at?: string | null
          tour_host_id?: string | null
          tour_notes?: string | null
          tour_outcome?: string | null
          updated_at?: string | null
          waitlist_joined_at?: string | null
          waitlist_last_contact_at?: string | null
          waitlist_last_response_at?: string | null
          waitlist_position?: number | null
          waitlist_priority?: string
          waitlist_response_due_at?: string | null
          waitlist_status?: string
          waitlist_unanswered_checkins?: number
        }
        Update: {
          agreement_data?: Json
          agreement_signed_at?: string | null
          agreement_version?: string | null
          application_data?: Json
          application_progress?: number
          application_submitted_at?: string | null
          child_date_of_birth?: string | null
          child_first_name?: string | null
          child_id?: string | null
          child_last_name?: string | null
          classroom_id?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string | null
          daycare_id?: string
          deposit_paid_at?: string | null
          deposit_payment_id?: string | null
          deposit_status?: string
          desired_start_date?: string | null
          documents_status?: Json
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          id?: string
          keep_on_file?: boolean
          notes?: string | null
          offer_accepted_at?: string | null
          offer_code?: string | null
          offer_decline_reason?: string | null
          offer_declined_at?: string | null
          offer_deposit_cents?: number | null
          offer_expires_at?: string | null
          offer_nudged_at?: string | null
          offer_sent_at?: string | null
          offer_status?: string
          offer_tuition_cents?: number | null
          offer_viewed_at?: string | null
          onboarding_steps?: Json
          parent_account_linked_at?: string | null
          parent_workflow_step?: string
          payment_mode?: string
          schedule?: Json
          source?: string | null
          stage?: string
          stage_changed_at?: string | null
          tour_at?: string | null
          tour_host_id?: string | null
          tour_notes?: string | null
          tour_outcome?: string | null
          updated_at?: string | null
          waitlist_joined_at?: string | null
          waitlist_last_contact_at?: string | null
          waitlist_last_response_at?: string | null
          waitlist_position?: number | null
          waitlist_priority?: string
          waitlist_response_due_at?: string | null
          waitlist_status?: string
          waitlist_unanswered_checkins?: number
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_tour_host_id_fkey"
            columns: ["tour_host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          archived_at: string | null
          billing_email: string | null
          billing_phone: string | null
          created_at: string
          daycare_id: string
          display_name: string
          id: string
          primary_contact_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          created_at?: string
          daycare_id: string
          display_name: string
          id?: string
          primary_contact_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          billing_email?: string | null
          billing_phone?: string | null
          created_at?: string
          daycare_id?: string
          display_name?: string
          id?: string
          primary_contact_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "families_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "families_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      family_billing_preferences: {
        Row: {
          autopay_enabled: boolean
          created_at: string
          daycare_id: string
          default_payment_method_id: string | null
          family_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          autopay_enabled?: boolean
          created_at?: string
          daycare_id: string
          default_payment_method_id?: string | null
          family_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          autopay_enabled?: boolean
          created_at?: string
          daycare_id?: string
          default_payment_method_id?: string | null
          family_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_billing_preferences_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_billing_preferences_default_payment_method_id_fkey"
            columns: ["default_payment_method_id"]
            isOneToOne: false
            referencedRelation: "family_payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_billing_preferences_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_billing_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      family_children: {
        Row: {
          child_id: string
          created_at: string
          family_id: string
          is_primary: boolean
        }
        Insert: {
          child_id: string
          created_at?: string
          family_id: string
          is_primary?: boolean
        }
        Update: {
          child_id?: string
          created_at?: string
          family_id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "family_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_children_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_ledger_accounts: {
        Row: {
          created_at: string
          currency: string
          daycare_id: string
          family_id: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          daycare_id: string
          family_id: string
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          daycare_id?: string
          family_id?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_ledger_accounts_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_accounts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_ledger_entries: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          daycare_id: string
          description: string
          effective_at: string
          entry_type: string
          family_id: string
          id: string
          reverses_entry_id: string | null
          source_invoice_id: string | null
          source_payment_id: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          created_by?: string | null
          currency?: string
          daycare_id: string
          description: string
          effective_at?: string
          entry_type: string
          family_id: string
          id?: string
          reverses_entry_id?: string | null
          source_invoice_id?: string | null
          source_payment_id?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          daycare_id?: string
          description?: string
          effective_at?: string
          entry_type?: string
          family_id?: string
          id?: string
          reverses_entry_id?: string | null
          source_invoice_id?: string | null
          source_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "family_ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_entries_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_entries_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: false
            referencedRelation: "family_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_entries_source_invoice_id_fkey"
            columns: ["source_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_ledger_entries_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          created_at: string
          family_id: string
          profile_id: string
          receives_billing: boolean
          receives_messages: boolean
          relationship: string | null
          role: string
        }
        Insert: {
          created_at?: string
          family_id: string
          profile_id: string
          receives_billing?: boolean
          receives_messages?: boolean
          relationship?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          profile_id?: string
          receives_billing?: boolean
          receives_messages?: boolean
          relationship?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      family_payment_methods: {
        Row: {
          brand: string
          created_at: string
          daycare_id: string
          expiry_month: number | null
          expiry_year: number | null
          family_id: string
          id: string
          last4: string
          method_type: string
          provider: string
          provider_payment_method_ref: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand: string
          created_at?: string
          daycare_id: string
          expiry_month?: number | null
          expiry_year?: number | null
          family_id: string
          id?: string
          last4: string
          method_type: string
          provider?: string
          provider_payment_method_ref?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          daycare_id?: string
          expiry_month?: number | null
          expiry_year?: number | null
          family_id?: string
          id?: string
          last4?: string
          method_type?: string
          provider?: string
          provider_payment_method_ref?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_payment_methods_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_payment_methods_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_acknowledgments: {
        Row: {
          acknowledged_at: string
          child_id: string
          created_at: string
          daycare_id: string
          id: string
          incident_id: string
          parent_id: string
          signed_name: string
          statement_text: string
          statement_version: string
        }
        Insert: {
          acknowledged_at?: string
          child_id: string
          created_at?: string
          daycare_id: string
          id?: string
          incident_id: string
          parent_id: string
          signed_name: string
          statement_text: string
          statement_version?: string
        }
        Update: {
          acknowledged_at?: string
          child_id?: string
          created_at?: string
          daycare_id?: string
          id?: string
          incident_id?: string
          parent_id?: string
          signed_name?: string
          statement_text?: string
          statement_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_acknowledgments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_acknowledgments_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_acknowledgments_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incident_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_acknowledgments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_reports: {
        Row: {
          body_parts: string[] | null
          child_id: string
          classroom_id: string | null
          created_at: string | null
          daycare_id: string
          description: string | null
          educator_id: string | null
          first_aid_by: string | null
          first_aid_given: string | null
          id: string
          injury_side: string | null
          injury_type: string
          location: string
          notes: string | null
          occurred_at: string
          parent_acknowledge_name: string | null
          parent_acknowledged_at: string | null
          parent_acknowledged_by: string | null
          parent_notified_at: string | null
          photo_paths: string[] | null
          severity: string
          signed_off_at: string | null
          signed_off_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string | null
          witness_id: string | null
          witnesses: string[] | null
        }
        Insert: {
          body_parts?: string[] | null
          child_id: string
          classroom_id?: string | null
          created_at?: string | null
          daycare_id: string
          description?: string | null
          educator_id?: string | null
          first_aid_by?: string | null
          first_aid_given?: string | null
          id?: string
          injury_side?: string | null
          injury_type?: string
          location?: string
          notes?: string | null
          occurred_at?: string
          parent_acknowledge_name?: string | null
          parent_acknowledged_at?: string | null
          parent_acknowledged_by?: string | null
          parent_notified_at?: string | null
          photo_paths?: string[] | null
          severity?: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          witness_id?: string | null
          witnesses?: string[] | null
        }
        Update: {
          body_parts?: string[] | null
          child_id?: string
          classroom_id?: string | null
          created_at?: string | null
          daycare_id?: string
          description?: string | null
          educator_id?: string | null
          first_aid_by?: string | null
          first_aid_given?: string | null
          id?: string
          injury_side?: string | null
          injury_type?: string
          location?: string
          notes?: string | null
          occurred_at?: string
          parent_acknowledge_name?: string | null
          parent_acknowledged_at?: string | null
          parent_acknowledged_by?: string | null
          parent_notified_at?: string | null
          photo_paths?: string[] | null
          severity?: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          witness_id?: string | null
          witnesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_reports_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_educator_id_fkey"
            columns: ["educator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_first_aid_by_fkey"
            columns: ["first_aid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_parent_acknowledged_by_fkey"
            columns: ["parent_acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_signed_off_by_fkey"
            columns: ["signed_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_witness_id_fkey"
            columns: ["witness_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount_cents: number
          billing_plan_id: string | null
          created_at: string | null
          daycare_id: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          unit_amount_cents: number
        }
        Insert: {
          amount_cents?: number
          billing_plan_id?: string | null
          created_at?: string | null
          daycare_id: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          unit_amount_cents?: number
        }
        Update: {
          amount_cents?: number
          billing_plan_id?: string | null
          created_at?: string | null
          daycare_id?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          unit_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_billing_plan_id_fkey"
            columns: ["billing_plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_reminder_events: {
        Row: {
          daycare_id: string
          id: string
          invoice_id: string
          outbox_id: string | null
          recipient_email: string
          sent_at: string
          sent_by: string
          status: string
          tone: string
        }
        Insert: {
          daycare_id: string
          id?: string
          invoice_id: string
          outbox_id?: string | null
          recipient_email: string
          sent_at?: string
          sent_by: string
          status?: string
          tone?: string
        }
        Update: {
          daycare_id?: string
          id?: string
          invoice_id?: string
          outbox_id?: string | null
          recipient_email?: string
          sent_at?: string
          sent_by?: string
          status?: string
          tone?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_reminder_events_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_reminder_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_reminder_events_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "notification_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_reminder_events_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_id: string | null
          billed_to: string | null
          child_id: string | null
          created_at: string | null
          currency: string
          daycare_id: string
          due_on: string | null
          enrollment_billing_schedule_id: string | null
          family_id: string | null
          id: string
          issued_on: string | null
          number: string | null
          service_period_end: string | null
          service_period_start: string | null
          status: string
          subtotal_cents: number
          total_cents: number
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          billed_to?: string | null
          child_id?: string | null
          created_at?: string | null
          currency?: string
          daycare_id: string
          due_on?: string | null
          enrollment_billing_schedule_id?: string | null
          family_id?: string | null
          id?: string
          issued_on?: string | null
          number?: string | null
          service_period_end?: string | null
          service_period_start?: string | null
          status?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          billed_to?: string | null
          child_id?: string | null
          created_at?: string | null
          currency?: string
          daycare_id?: string
          due_on?: string | null
          enrollment_billing_schedule_id?: string | null
          family_id?: string | null
          id?: string
          issued_on?: string | null
          number?: string | null
          service_period_end?: string | null
          service_period_start?: string | null
          status?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "family_ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_billed_to_fkey"
            columns: ["billed_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_enrollment_billing_schedule_id_fkey"
            columns: ["enrollment_billing_schedule_id"]
            isOneToOne: false
            referencedRelation: "enrollment_billing_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      late_pickup_events: {
        Row: {
          attendance_id: string
          billable_minutes: number
          billing_status: string
          child_id: string
          collected_by: string
          conversation_required: boolean
          created_at: string
          daycare_id: string
          expected_at: string
          family_notified_at: string | null
          fee_cents: number
          id: string
          invoice_id: string | null
          invoice_line_id: string | null
          late_minutes: number
          notes: string | null
          occurred_on: string
          picked_up_at: string
          policy_id: string | null
          recorded_by: string
        }
        Insert: {
          attendance_id: string
          billable_minutes?: number
          billing_status?: string
          child_id: string
          collected_by: string
          conversation_required?: boolean
          created_at?: string
          daycare_id: string
          expected_at: string
          family_notified_at?: string | null
          fee_cents?: number
          id?: string
          invoice_id?: string | null
          invoice_line_id?: string | null
          late_minutes: number
          notes?: string | null
          occurred_on: string
          picked_up_at: string
          policy_id?: string | null
          recorded_by: string
        }
        Update: {
          attendance_id?: string
          billable_minutes?: number
          billing_status?: string
          child_id?: string
          collected_by?: string
          conversation_required?: boolean
          created_at?: string
          daycare_id?: string
          expected_at?: string
          family_notified_at?: string | null
          fee_cents?: number
          id?: string
          invoice_id?: string | null
          invoice_line_id?: string | null
          late_minutes?: number
          notes?: string | null
          occurred_on?: string
          picked_up_at?: string
          policy_id?: string | null
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "late_pickup_events_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: true
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_events_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_events_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_events_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_events_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "late_pickup_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      late_pickup_policies: {
        Row: {
          closing_time: string
          conversation_after_count: number
          created_at: string
          created_by: string | null
          daily_cap_cents: number
          daycare_id: string
          effective_from: string
          fee_per_minute_cents: number
          grace_minutes: number
          id: string
        }
        Insert: {
          closing_time?: string
          conversation_after_count?: number
          created_at?: string
          created_by?: string | null
          daily_cap_cents?: number
          daycare_id: string
          effective_from?: string
          fee_per_minute_cents?: number
          grace_minutes?: number
          id?: string
        }
        Update: {
          closing_time?: string
          conversation_after_count?: number
          created_at?: string
          created_by?: string | null
          daily_cap_cents?: number
          daycare_id?: string
          effective_from?: string
          fee_per_minute_cents?: number
          grace_minutes?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "late_pickup_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_pickup_policies_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_entries: {
        Row: {
          amount: string
          created_at: string | null
          daily_log_id: string
          food_type: string
          id: string
          meal_menu_item_id: string | null
          time: string
        }
        Insert: {
          amount: string
          created_at?: string | null
          daily_log_id: string
          food_type: string
          id?: string
          meal_menu_item_id?: string | null
          time: string
        }
        Update: {
          amount?: string
          created_at?: string | null
          daily_log_id?: string
          food_type?: string
          id?: string
          meal_menu_item_id?: string | null
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_entries_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_entries_meal_menu_item_id_fkey"
            columns: ["meal_menu_item_id"]
            isOneToOne: false
            referencedRelation: "meal_menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_menu_items: {
        Row: {
          allergens: string[]
          classroom_id: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          food_description: string
          id: string
          meal_label: string
          meal_time: string
          meal_type: string
          menu_date: string
          updated_at: string
        }
        Insert: {
          allergens?: string[]
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          food_description: string
          id?: string
          meal_label: string
          meal_time: string
          meal_type: string
          menu_date: string
          updated_at?: string
        }
        Update: {
          allergens?: string[]
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          food_description?: string
          id?: string
          meal_label?: string
          meal_time?: string
          meal_type?: string
          menu_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_menu_items_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_menu_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_menu_items_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_authorizations: {
        Row: {
          active: boolean
          as_needed_condition: string | null
          authorization_version: string
          child_id: string
          consented_at: string | null
          created_at: string | null
          daycare_id: string
          dosage: string
          end_date: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          label_photo_path: string | null
          max_daily_doses: number | null
          medication_type: string
          name: string
          notes: string | null
          parent_id: string | null
          renewed_from_id: string | null
          route: string | null
          schedule: string | null
          schedule_type: string
          scheduled_times: string[]
          signed_at: string | null
          signed_name: string | null
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          as_needed_condition?: string | null
          authorization_version?: string
          child_id: string
          consented_at?: string | null
          created_at?: string | null
          daycare_id: string
          dosage: string
          end_date?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          label_photo_path?: string | null
          max_daily_doses?: number | null
          medication_type?: string
          name: string
          notes?: string | null
          parent_id?: string | null
          renewed_from_id?: string | null
          route?: string | null
          schedule?: string | null
          schedule_type?: string
          scheduled_times?: string[]
          signed_at?: string | null
          signed_name?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          as_needed_condition?: string | null
          authorization_version?: string
          child_id?: string
          consented_at?: string | null
          created_at?: string | null
          daycare_id?: string
          dosage?: string
          end_date?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          label_photo_path?: string | null
          max_daily_doses?: number | null
          medication_type?: string
          name?: string
          notes?: string | null
          parent_id?: string | null
          renewed_from_id?: string | null
          route?: string | null
          schedule?: string | null
          schedule_type?: string
          scheduled_times?: string[]
          signed_at?: string | null
          signed_name?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_authorizations_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_authorizations_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_authorizations_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_authorizations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_authorizations_renewed_from_id_fkey"
            columns: ["renewed_from_id"]
            isOneToOne: false
            referencedRelation: "medication_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_logs: {
        Row: {
          administered_at: string
          administered_by: string | null
          authorization_id: string
          child_id: string
          created_at: string | null
          daycare_id: string
          dosage_given: string | null
          id: string
          notes: string | null
          parent_notified_at: string | null
          route_given: string | null
          safety_checks: Json
          witness_id: string | null
        }
        Insert: {
          administered_at?: string
          administered_by?: string | null
          authorization_id: string
          child_id: string
          created_at?: string | null
          daycare_id: string
          dosage_given?: string | null
          id?: string
          notes?: string | null
          parent_notified_at?: string | null
          route_given?: string | null
          safety_checks?: Json
          witness_id?: string | null
        }
        Update: {
          administered_at?: string
          administered_by?: string | null
          authorization_id?: string
          child_id?: string
          created_at?: string | null
          daycare_id?: string
          dosage_given?: string | null
          id?: string
          notes?: string | null
          parent_notified_at?: string | null
          route_given?: string | null
          safety_checks?: Json
          witness_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_logs_administered_by_fkey"
            columns: ["administered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "medication_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_witness_id_fkey"
            columns: ["witness_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          message_id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          message_id: string
          profile_id: string
          read_at?: string
        }
        Update: {
          message_id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_kind: string | null
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          body: string
          child_id: string | null
          conversation_id: string | null
          created_at: string | null
          daycare_id: string
          id: string
          read_at: string | null
          sender_id: string | null
        }
        Insert: {
          attachment_kind?: string | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          body: string
          child_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          daycare_id: string
          id?: string
          read_at?: string | null
          sender_id?: string | null
        }
        Update: {
          attachment_kind?: string | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          body?: string
          child_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          daycare_id?: string
          id?: string
          read_at?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_roll_call_sessions: {
        Row: {
          absent_count: number
          attendance_date: string
          awaited_count: number
          classroom_id: string
          completed_at: string
          completed_by: string
          created_at: string
          daycare_id: string
          id: string
          present_count: number
          updated_at: string
        }
        Insert: {
          absent_count?: number
          attendance_date: string
          awaited_count?: number
          classroom_id: string
          completed_at?: string
          completed_by: string
          created_at?: string
          daycare_id: string
          id?: string
          present_count?: number
          updated_at?: string
        }
        Update: {
          absent_count?: number
          attendance_date?: string
          awaited_count?: number
          classroom_id?: string
          completed_at?: string
          completed_by?: string
          created_at?: string
          daycare_id?: string
          id?: string
          present_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobile_roll_call_sessions_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobile_roll_call_sessions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobile_roll_call_sessions_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_settings: {
        Row: {
          created_at: string
          daycare_id: string
          email_mode: string
          profile_id: string
          quiet_hours_enabled: boolean
          quiet_hours_end: string
          quiet_hours_start: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daycare_id: string
          email_mode?: string
          profile_id: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daycare_id?: string
          email_mode?: string
          profile_id?: string
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_settings_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_settings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          available_at: string
          body: string | null
          channel: string
          created_at: string
          daycare_id: string
          dedupe_key: string
          delivered_at: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          provider_response: Json | null
          recipient_email: string | null
          recipient_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          body?: string | null
          channel: string
          created_at?: string
          daycare_id: string
          dedupe_key: string
          delivered_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          provider_response?: Json | null
          recipient_email?: string | null
          recipient_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          body?: string | null
          channel?: string
          created_at?: string
          daycare_id?: string
          dedupe_key?: string
          delivered_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          provider_response?: Json | null
          recipient_email?: string | null
          recipient_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          daycare_id: string
          email: boolean
          in_app: boolean
          kind: string
          profile_id: string
          push: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          daycare_id: string
          email?: boolean
          in_app?: boolean
          kind: string
          profile_id: string
          push?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          daycare_id?: string
          email?: boolean
          in_app?: boolean
          kind?: string
          profile_id?: string
          push?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          daycare_id: string
          id: string
          kind: string
          payload: Json | null
          profile_id: string
          read_at: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          daycare_id: string
          id?: string
          kind: string
          payload?: Json | null
          profile_id: string
          read_at?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string | null
          daycare_id?: string
          id?: string
          kind?: string
          payload?: Json | null
          profile_id?: string
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_absence_reports: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          child_id: string
          created_at: string
          daycare_id: string
          ends_on: string
          id: string
          note: string | null
          reason: string
          reported_by: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          child_id: string
          created_at?: string
          daycare_id: string
          ends_on: string
          id?: string
          note?: string | null
          reason: string
          reported_by: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          child_id?: string
          created_at?: string
          daycare_id?: string
          ends_on?: string
          id?: string
          note?: string | null
          reason?: string
          reported_by?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_absence_reports_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_absence_reports_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_absence_reports_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_absence_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_children: {
        Row: {
          child_id: string
          consent_declined_at: string | null
          consent_given_at: string | null
          consent_version: string | null
          created_at: string | null
          is_primary: boolean
          parent_id: string
          pickup_authorized: boolean
          relationship: string | null
        }
        Insert: {
          child_id: string
          consent_declined_at?: string | null
          consent_given_at?: string | null
          consent_version?: string | null
          created_at?: string | null
          is_primary?: boolean
          parent_id: string
          pickup_authorized?: boolean
          relationship?: string | null
        }
        Update: {
          child_id?: string
          consent_declined_at?: string | null
          consent_given_at?: string | null
          consent_version?: string | null
          created_at?: string | null
          is_primary?: boolean
          parent_id?: string
          pickup_authorized?: boolean
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parent_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_children_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_data_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          daycare_id: string
          handled_by: string | null
          id: string
          notes: string | null
          profile_id: string
          request_type: string
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          daycare_id: string
          handled_by?: string | null
          id?: string
          notes?: string | null
          profile_id: string
          request_type: string
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          daycare_id?: string
          handled_by?: string | null
          id?: string
          notes?: string | null
          profile_id?: string
          request_type?: string
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_data_requests_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_data_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_data_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_document_requests: {
        Row: {
          child_id: string
          completed_at: string | null
          created_at: string
          daycare_id: string
          due_on: string | null
          id: string
          kind: string
          latest_document_id: string | null
          message: string | null
          rejection_reason: string | null
          requested_at: string
          requested_by: string | null
          status: string
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          child_id: string
          completed_at?: string | null
          created_at?: string
          daycare_id: string
          due_on?: string | null
          id?: string
          kind: string
          latest_document_id?: string | null
          message?: string | null
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          child_id?: string
          completed_at?: string | null
          created_at?: string
          daycare_id?: string
          due_on?: string | null
          id?: string
          kind?: string
          latest_document_id?: string | null
          message?: string | null
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
          submitted_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_document_requests_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_requests_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_requests_latest_document_id_fkey"
            columns: ["latest_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_document_submissions: {
        Row: {
          created_at: string
          daycare_id: string
          document_id: string
          id: string
          rejection_reason: string | null
          request_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          submitted_by: string
        }
        Insert: {
          created_at?: string
          daycare_id: string
          document_id: string
          id?: string
          rejection_reason?: string | null
          request_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          submitted_by: string
        }
        Update: {
          created_at?: string
          daycare_id?: string
          document_id?: string
          id?: string
          rejection_reason?: string | null
          request_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_document_submissions_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_submissions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_submissions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "parent_document_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_document_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          amount_cents: number
          created_at: string
          daycare_id: string
          family_id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          daycare_id: string
          family_id: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          daycare_id?: string
          family_id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          account_id: string | null
          amount_cents: number
          created_at: string | null
          currency: string
          daycare_id: string
          external_ref: string | null
          family_id: string | null
          id: string
          invoice_id: string | null
          method: string | null
          paid_at: string | null
          paid_by: string | null
          payment_method_id: string | null
          receipt_emailed_to: string | null
          receipt_number: string | null
          refund_reason: string | null
          refunded_at: string | null
          status: string
        }
        Insert: {
          account_id?: string | null
          amount_cents: number
          created_at?: string | null
          currency?: string
          daycare_id: string
          external_ref?: string | null
          family_id?: string | null
          id?: string
          invoice_id?: string | null
          method?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method_id?: string | null
          receipt_emailed_to?: string | null
          receipt_number?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          status?: string
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          created_at?: string | null
          currency?: string
          daycare_id?: string
          external_ref?: string | null
          family_id?: string | null
          id?: string
          invoice_id?: string | null
          method?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_method_id?: string | null
          receipt_emailed_to?: string | null
          receipt_number?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "family_ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "family_payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          caption: string | null
          created_at: string | null
          daily_log_id: string
          id: string
          storage_path: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          daily_log_id: string
          id?: string
          storage_path: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          daily_log_id?: string
          id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_passes: {
        Row: {
          child_id: string
          code_hash: string
          created_at: string
          created_by: string
          daycare_id: string
          expires_at: string
          id: string
          pickup_id: string | null
          presenter_name: string
          presenter_profile_id: string | null
          relationship: string | null
          revoked_at: string | null
          token_hash: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          child_id: string
          code_hash: string
          created_at?: string
          created_by: string
          daycare_id: string
          expires_at: string
          id?: string
          pickup_id?: string | null
          presenter_name: string
          presenter_profile_id?: string | null
          relationship?: string | null
          revoked_at?: string | null
          token_hash: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          child_id?: string
          code_hash?: string
          created_at?: string
          created_by?: string
          daycare_id?: string
          expires_at?: string
          id?: string
          pickup_id?: string | null
          presenter_name?: string
          presenter_profile_id?: string | null
          relationship?: string | null
          revoked_at?: string | null
          token_hash?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_passes_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_passes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_passes_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_passes_pickup_id_fkey"
            columns: ["pickup_id"]
            isOneToOne: false
            referencedRelation: "child_pickups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_passes_presenter_profile_id_fkey"
            columns: ["presenter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_passes_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_plans: {
        Row: {
          child_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          id: string
          pickup_id: string | null
          presenter_name: string
          presenter_profile_id: string | null
          relationship: string | null
          scheduled_for: string | null
          scheduled_on: string
          status: string
          updated_at: string
        }
        Insert: {
          child_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          id?: string
          pickup_id?: string | null
          presenter_name: string
          presenter_profile_id?: string | null
          relationship?: string | null
          scheduled_for?: string | null
          scheduled_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          child_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          id?: string
          pickup_id?: string | null
          presenter_name?: string
          presenter_profile_id?: string | null
          relationship?: string | null
          scheduled_for?: string | null
          scheduled_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_plans_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_plans_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_plans_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_plans_pickup_id_fkey"
            columns: ["pickup_id"]
            isOneToOne: false
            referencedRelation: "child_pickups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_plans_presenter_profile_id_fkey"
            columns: ["presenter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_security_events: {
        Row: {
          attempted_name: string | null
          child_id: string
          created_at: string
          daycare_id: string
          id: string
          notes: string | null
          reported_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempted_name?: string | null
          child_id: string
          created_at?: string
          daycare_id: string
          id?: string
          notes?: string | null
          reported_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempted_name?: string | null
          child_id?: string
          created_at?: string
          daycare_id?: string
          id?: string
          notes?: string | null
          reported_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_security_events_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_security_events_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_security_events_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_security_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_daycare_memberships: {
        Row: {
          color: string
          created_at: string
          daycare_id: string
          group_name: string
          location_label: string
          profile_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          daycare_id: string
          group_name: string
          location_label: string
          profile_id: string
        }
        Update: {
          color?: string
          created_at?: string
          daycare_id?: string
          group_name?: string
          location_label?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_daycare_memberships_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_daycare_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          archived_at: string | null
          avatar_url: string | null
          center_role_id: string | null
          classroom_id: string | null
          created_at: string | null
          daycare_id: string | null
          display_name: string | null
          email: string
          full_name: string
          id: string
          phone: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          center_role_id?: string | null
          classroom_id?: string | null
          created_at?: string | null
          daycare_id?: string | null
          display_name?: string | null
          email: string
          full_name: string
          id: string
          phone?: string | null
          role: string
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          avatar_url?: string | null
          center_role_id?: string | null
          classroom_id?: string | null
          created_at?: string | null
          daycare_id?: string | null
          display_name?: string | null
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_center_role_id_fkey"
            columns: ["center_role_id"]
            isOneToOne: false
            referencedRelation: "center_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string | null
          id: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_windows: {
        Row: {
          hits: number
          scope: string
          subject_hash: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          hits?: number
          scope: string
          subject_hash: string
          updated_at?: string
          window_started_at: string
        }
        Update: {
          hits?: number
          scope?: string
          subject_hash?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      report_exports: {
        Row: {
          created_by: string | null
          daycare_id: string
          ends_on: string | null
          expires_at: string
          format: string
          generated_at: string
          id: string
          parameters: Json
          report_kind: string
          row_count: number | null
          starts_on: string | null
          title: string
        }
        Insert: {
          created_by?: string | null
          daycare_id: string
          ends_on?: string | null
          expires_at?: string
          format: string
          generated_at?: string
          id?: string
          parameters?: Json
          report_kind: string
          row_count?: number | null
          starts_on?: string | null
          title: string
        }
        Update: {
          created_by?: string | null
          daycare_id?: string
          ends_on?: string | null
          expires_at?: string
          format?: string
          generated_at?: string
          id?: string
          parameters?: Json
          report_kind?: string
          row_count?: number | null
          starts_on?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_exports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_exports_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          active: boolean
          cadence: string
          created_at: string
          created_by: string | null
          daycare_id: string
          delivery_day: number
          delivery_time: string
          formats: string[]
          id: string
          last_error: string | null
          last_run_at: string | null
          next_run_at: string | null
          recipient_ids: string[]
          report_kind: string
          skip_empty: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          cadence: string
          created_at?: string
          created_by?: string | null
          daycare_id: string
          delivery_day: number
          delivery_time?: string
          formats?: string[]
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          next_run_at?: string | null
          recipient_ids?: string[]
          report_kind: string
          skip_empty?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          cadence?: string
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          delivery_day?: number
          delivery_time?: string
          formats?: string[]
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          next_run_at?: string | null
          recipient_ids?: string[]
          report_kind?: string
          skip_empty?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      room_activity_nudges: {
        Row: {
          classroom_id: string
          created_at: string
          daycare_id: string
          id: string
          message: string
          mode: string
          responded_at: string | null
          responded_by: string | null
          response: string | null
          sent_by: string
          snoozed_until: string | null
        }
        Insert: {
          classroom_id: string
          created_at?: string
          daycare_id: string
          id?: string
          message: string
          mode?: string
          responded_at?: string | null
          responded_by?: string | null
          response?: string | null
          sent_by: string
          snoozed_until?: string | null
        }
        Update: {
          classroom_id?: string
          created_at?: string
          daycare_id?: string
          id?: string
          message?: string
          mode?: string
          responded_at?: string | null
          responded_by?: string | null
          response?: string | null
          sent_by?: string
          snoozed_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_activity_nudges_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_activity_nudges_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_activity_nudges_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_activity_nudges_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_combinations: {
        Row: {
          activated_at: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          enabled: boolean
          ends_at: string
          host_classroom_id: string | null
          id: string
          paused_on: string | null
          period: string
          source_classroom_id: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          enabled?: boolean
          ends_at: string
          host_classroom_id?: string | null
          id?: string
          paused_on?: string | null
          period: string
          source_classroom_id?: string | null
          starts_at: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          enabled?: boolean
          ends_at?: string
          host_classroom_id?: string | null
          id?: string
          paused_on?: string | null
          period?: string
          source_classroom_id?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_combinations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_combinations_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_combinations_host_classroom_id_fkey"
            columns: ["host_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_combinations_source_classroom_id_fkey"
            columns: ["source_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_coverage_assignments: {
        Row: {
          classroom_id: string
          created_at: string
          created_by: string | null
          daycare_id: string
          ends_at: string
          id: string
          notes: string | null
          plan_id: string | null
          review_alert_version: number
          review_issue: string | null
          review_issue_detected_at: string | null
          staff_member_id: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          created_by?: string | null
          daycare_id: string
          ends_at: string
          id?: string
          notes?: string | null
          plan_id?: string | null
          review_alert_version?: number
          review_issue?: string | null
          review_issue_detected_at?: string | null
          staff_member_id: string
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          ends_at?: string
          id?: string
          notes?: string | null
          plan_id?: string | null
          review_alert_version?: number
          review_issue?: string | null
          review_issue_detected_at?: string | null
          staff_member_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_coverage_assignments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_coverage_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_coverage_assignments_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_coverage_assignments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "room_coverage_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_coverage_assignments_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      room_coverage_plans: {
        Row: {
          classroom_id: string
          created_at: string
          created_by: string
          daycare_id: string
          id: string
          planned_on: string
          request: Json
        }
        Insert: {
          classroom_id: string
          created_at?: string
          created_by: string
          daycare_id: string
          id: string
          planned_on: string
          request: Json
        }
        Update: {
          classroom_id?: string
          created_at?: string
          created_by?: string
          daycare_id?: string
          id?: string
          planned_on?: string
          request?: Json
        }
        Relationships: [
          {
            foreignKeyName: "room_coverage_plans_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_coverage_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_coverage_plans_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      room_ratio_events: {
        Row: {
          classroom_id: string
          created_at: string
          daycare_id: string
          id: string
          minimum_staff: number
          peak_present: number
          required_staff: number
          resolved_at: string | null
          started_at: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          daycare_id: string
          id?: string
          minimum_staff?: number
          peak_present?: number
          required_staff?: number
          resolved_at?: string | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          daycare_id?: string
          id?: string
          minimum_staff?: number
          peak_present?: number
          required_staff?: number
          resolved_at?: string | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_ratio_events_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_ratio_events_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
        ]
      }
      room_ratio_history: {
        Row: {
          classroom_id: string
          created_at: string
          daycare_id: string
          ends_at: string | null
          id: string
          max_children_per_staff: number
          present_count: number
          recorded_by: string | null
          required_staff: number
          source: string
          staff_count: number
          starts_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          daycare_id: string
          ends_at?: string | null
          id?: string
          max_children_per_staff: number
          present_count: number
          recorded_by?: string | null
          required_staff: number
          source: string
          staff_count: number
          starts_at: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          daycare_id?: string
          ends_at?: string | null
          id?: string
          max_children_per_staff?: number
          present_count?: number
          recorded_by?: string | null
          required_staff?: number
          source?: string
          staff_count?: number
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_ratio_history_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_ratio_history_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_ratio_history_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_transition_plans: {
        Row: {
          child_id: string
          created_at: string
          created_by: string | null
          currency: string
          current_tuition_cents: number | null
          daycare_id: string
          family_message: string | null
          family_visible: boolean
          from_classroom_id: string
          id: string
          move_on: string
          new_tuition_cents: number | null
          notes: string | null
          published_at: string | null
          status: string
          to_classroom_id: string
          transition_ends_on: string | null
          transition_starts_on: string | null
          transition_week: boolean
          updated_at: string
        }
        Insert: {
          child_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_tuition_cents?: number | null
          daycare_id: string
          family_message?: string | null
          family_visible?: boolean
          from_classroom_id: string
          id?: string
          move_on: string
          new_tuition_cents?: number | null
          notes?: string | null
          published_at?: string | null
          status?: string
          to_classroom_id: string
          transition_ends_on?: string | null
          transition_starts_on?: string | null
          transition_week?: boolean
          updated_at?: string
        }
        Update: {
          child_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_tuition_cents?: number | null
          daycare_id?: string
          family_message?: string | null
          family_visible?: boolean
          from_classroom_id?: string
          id?: string
          move_on?: string
          new_tuition_cents?: number | null
          notes?: string | null
          published_at?: string | null
          status?: string
          to_classroom_id?: string
          transition_ends_on?: string | null
          transition_starts_on?: string | null
          transition_week?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_transition_plans_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_plans_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_plans_from_classroom_id_fkey"
            columns: ["from_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_plans_to_classroom_id_fkey"
            columns: ["to_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_transition_wait_requests: {
        Row: {
          child_id: string
          converted_plan_id: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          from_classroom_id: string
          id: string
          not_before: string
          notes: string | null
          status: string
          to_classroom_id: string
          updated_at: string
        }
        Insert: {
          child_id: string
          converted_plan_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          from_classroom_id: string
          id?: string
          not_before: string
          notes?: string | null
          status?: string
          to_classroom_id: string
          updated_at?: string
        }
        Update: {
          child_id?: string
          converted_plan_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          from_classroom_id?: string
          id?: string
          not_before?: string
          notes?: string | null
          status?: string
          to_classroom_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_transition_wait_requests_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_wait_requests_converted_plan_id_fkey"
            columns: ["converted_plan_id"]
            isOneToOne: false
            referencedRelation: "room_transition_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_wait_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_wait_requests_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_wait_requests_from_classroom_id_fkey"
            columns: ["from_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_transition_wait_requests_to_classroom_id_fkey"
            columns: ["to_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_vacancy_reviews: {
        Row: {
          available_on: string
          classroom_id: string
          created_at: string
          daycare_id: string
          enrollment_id: string | null
          id: string
          offer_sent_at: string | null
          release_reason: string | null
          reviewed_by: string | null
          source_child_departure_id: string | null
          source_enrollment_id: string | null
          source_offer_sent_at: string | null
          source_transition_plan_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          available_on: string
          classroom_id: string
          created_at?: string
          daycare_id: string
          enrollment_id?: string | null
          id?: string
          offer_sent_at?: string | null
          release_reason?: string | null
          reviewed_by?: string | null
          source_child_departure_id?: string | null
          source_enrollment_id?: string | null
          source_offer_sent_at?: string | null
          source_transition_plan_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          available_on?: string
          classroom_id?: string
          created_at?: string
          daycare_id?: string
          enrollment_id?: string | null
          id?: string
          offer_sent_at?: string | null
          release_reason?: string | null
          reviewed_by?: string | null
          source_child_departure_id?: string | null
          source_enrollment_id?: string | null
          source_offer_sent_at?: string | null
          source_transition_plan_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_vacancy_reviews_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_vacancy_reviews_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_vacancy_reviews_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_vacancy_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_vacancy_reviews_source_child_departure_id_fkey"
            columns: ["source_child_departure_id"]
            isOneToOne: false
            referencedRelation: "child_departures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_vacancy_reviews_source_enrollment_id_fkey"
            columns: ["source_enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_vacancy_reviews_source_transition_plan_id_fkey"
            columns: ["source_transition_plan_id"]
            isOneToOne: true
            referencedRelation: "room_transition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_entries: {
        Row: {
          created_at: string | null
          daily_log_id: string
          end_time: string | null
          id: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          daily_log_id: string
          end_time?: string | null
          id?: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          daily_log_id?: string
          end_time?: string | null
          id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "sleep_entries_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_credential_submissions: {
        Row: {
          completed_on: string
          created_at: string
          credential_id: string
          credential_number: string | null
          daycare_id: string
          document_id: string
          expires_on: string
          id: string
          issuer: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_member_id: string
          status: string
          submitted_by: string
          updated_at: string
        }
        Insert: {
          completed_on: string
          created_at?: string
          credential_id: string
          credential_number?: string | null
          daycare_id: string
          document_id: string
          expires_on: string
          id?: string
          issuer: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_member_id: string
          status?: string
          submitted_by: string
          updated_at?: string
        }
        Update: {
          completed_on?: string
          created_at?: string
          credential_id?: string
          credential_number?: string | null
          daycare_id?: string
          document_id?: string
          expires_on?: string
          id?: string
          issuer?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_member_id?: string
          status?: string
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_credential_submissions_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "staff_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credential_submissions_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credential_submissions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credential_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credential_submissions_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credential_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_credentials: {
        Row: {
          archived_at: string | null
          completed_on: string | null
          created_at: string
          credential_number: string | null
          daycare_id: string
          document_id: string | null
          expires_on: string | null
          id: string
          issuer: string | null
          name: string
          ratio_qualifying: boolean
          required: boolean
          staff_member_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          completed_on?: string | null
          created_at?: string
          credential_number?: string | null
          daycare_id: string
          document_id?: string | null
          expires_on?: string | null
          id?: string
          issuer?: string | null
          name: string
          ratio_qualifying?: boolean
          required?: boolean
          staff_member_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          completed_on?: string | null
          created_at?: string
          credential_number?: string | null
          daycare_id?: string
          document_id?: string | null
          expires_on?: string | null
          id?: string
          issuer?: string | null
          name?: string
          ratio_qualifying?: boolean
          required?: boolean
          staff_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_credentials_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credentials_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_credentials_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_delegations: {
        Row: {
          access_level: string
          areas: string[]
          created_at: string
          daycare_id: string
          delegate_profile_id: string
          ends_at: string
          granted_by: string
          id: string
          revoked_at: string | null
          revoked_by: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          access_level: string
          areas?: string[]
          created_at?: string
          daycare_id: string
          delegate_profile_id: string
          ends_at: string
          granted_by: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at?: string
          updated_at?: string
        }
        Update: {
          access_level?: string
          areas?: string[]
          created_at?: string
          daycare_id?: string
          delegate_profile_id?: string
          ends_at?: string
          granted_by?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_delegations_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_delegations_delegate_profile_id_fkey"
            columns: ["delegate_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_delegations_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_delegations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_terms_at: string | null
          accepted_terms_version: string | null
          classroom_id: string | null
          code: string
          created_at: string | null
          daycare_id: string
          email: string
          expires_at: string | null
          full_name: string | null
          id: string
          invited_by: string | null
          job_title: string | null
          last_sent_at: string
          require_background_check: boolean
          resend_count: number
          role: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_terms_at?: string | null
          accepted_terms_version?: string | null
          classroom_id?: string | null
          code: string
          created_at?: string | null
          daycare_id: string
          email: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          invited_by?: string | null
          job_title?: string | null
          last_sent_at?: string
          require_background_check?: boolean
          resend_count?: number
          role: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_terms_at?: string | null
          accepted_terms_version?: string | null
          classroom_id?: string | null
          code?: string
          created_at?: string | null
          daycare_id?: string
          email?: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          invited_by?: string | null
          job_title?: string | null
          last_sent_at?: string
          require_background_check?: boolean
          resend_count?: number
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          annual_paid_leave_days: number
          archived_at: string | null
          background_check_required: boolean
          certifications: Json | null
          created_at: string | null
          daycare_id: string
          employment_type: string | null
          ended_on: string | null
          id: string
          job_title: string | null
          profile_id: string | null
          started_on: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          annual_paid_leave_days?: number
          archived_at?: string | null
          background_check_required?: boolean
          certifications?: Json | null
          created_at?: string | null
          daycare_id: string
          employment_type?: string | null
          ended_on?: string | null
          id?: string
          job_title?: string | null
          profile_id?: string | null
          started_on?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          annual_paid_leave_days?: number
          archived_at?: string | null
          background_check_required?: boolean
          certifications?: Json | null
          created_at?: string | null
          daycare_id?: string
          employment_type?: string | null
          ended_on?: string | null
          id?: string
          job_title?: string | null
          profile_id?: string | null
          started_on?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_regular_schedules: {
        Row: {
          classroom_id: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          ends_local: string
          id: string
          staff_member_id: string
          starts_local: string
          unpaid_break_minutes: number
          updated_at: string
          weekday: number
        }
        Insert: {
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          ends_local: string
          id?: string
          staff_member_id: string
          starts_local: string
          unpaid_break_minutes?: number
          updated_at?: string
          weekday: number
        }
        Update: {
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          ends_local?: string
          id?: string
          staff_member_id?: string
          starts_local?: string
          unpaid_break_minutes?: number
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_regular_schedules_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_regular_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_regular_schedules_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_regular_schedules_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          classroom_id: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          ends_at: string
          id: string
          notes: string | null
          planned_break_ends_at: string | null
          planned_break_starts_at: string | null
          published_at: string | null
          regular_schedule_id: string | null
          staff_member_id: string
          starts_at: string
          status: string
          unpaid_break_minutes: number
          updated_at: string
        }
        Insert: {
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          ends_at: string
          id?: string
          notes?: string | null
          planned_break_ends_at?: string | null
          planned_break_starts_at?: string | null
          published_at?: string | null
          regular_schedule_id?: string | null
          staff_member_id: string
          starts_at: string
          status?: string
          unpaid_break_minutes?: number
          updated_at?: string
        }
        Update: {
          classroom_id?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          ends_at?: string
          id?: string
          notes?: string | null
          planned_break_ends_at?: string | null
          planned_break_starts_at?: string | null
          published_at?: string | null
          regular_schedule_id?: string | null
          staff_member_id?: string
          starts_at?: string
          status?: string
          unpaid_break_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_regular_schedule_id_fkey"
            columns: ["regular_schedule_id"]
            isOneToOne: false
            referencedRelation: "staff_regular_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_time_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          break_minutes: number
          classroom_id: string | null
          clocked_in_at: string
          clocked_out_at: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          id: string
          notes: string | null
          shift_id: string | null
          source: string
          staff_member_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          classroom_id?: string | null
          clocked_in_at: string
          clocked_out_at?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id: string
          id?: string
          notes?: string | null
          shift_id?: string | null
          source?: string
          staff_member_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          classroom_id?: string | null
          clocked_in_at?: string
          clocked_out_at?: string | null
          created_at?: string
          created_by?: string | null
          daycare_id?: string
          id?: string
          notes?: string | null
          shift_id?: string | null
          source?: string
          staff_member_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_time_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_entries_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_entries_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_entries_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "staff_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_entries_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_time_off_requests: {
        Row: {
          created_at: string
          daycare_id: string
          decision_notes: string | null
          ends_on: string
          id: string
          kind: string
          reason: string | null
          replaces_request_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_member_id: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daycare_id: string
          decision_notes?: string | null
          ends_on: string
          id?: string
          kind?: string
          reason?: string | null
          replaces_request_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_member_id: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daycare_id?: string
          decision_notes?: string | null
          ends_on?: string
          id?: string
          kind?: string
          reason?: string | null
          replaces_request_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_member_id?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_time_off_requests_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_off_requests_replaces_request_id_fkey"
            columns: ["replaces_request_id"]
            isOneToOne: false
            referencedRelation: "staff_time_off_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_off_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_time_off_requests_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      statements: {
        Row: {
          account_id: string | null
          child_id: string | null
          created_at: string | null
          daycare_id: string
          family_id: string | null
          id: string
          period_end: string
          period_start: string
          storage_path: string | null
          total_cents: number
        }
        Insert: {
          account_id?: string | null
          child_id?: string | null
          created_at?: string | null
          daycare_id: string
          family_id?: string | null
          id?: string
          period_end: string
          period_start: string
          storage_path?: string | null
          total_cents?: number
        }
        Update: {
          account_id?: string | null
          child_id?: string | null
          created_at?: string | null
          daycare_id?: string
          family_id?: string | null
          id?: string
          period_end?: string
          period_start?: string
          storage_path?: string | null
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "statements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "family_ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statements_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statements_daycare_id_fkey"
            columns: ["daycare_id"]
            isOneToOne: false
            referencedRelation: "daycares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statements_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_requests: {
        Row: {
          created_at: string | null
          daily_log_id: string
          id: string
          item_name: string
        }
        Insert: {
          created_at?: string | null
          daily_log_id: string
          id?: string
          item_name: string
        }
        Update: {
          created_at?: string | null
          daily_log_id?: string
          id?: string
          item_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_requests_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _active_room_combination: {
        Args: { p_at?: string; p_room: string }
        Returns: {
          activated_at: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          enabled: boolean
          ends_at: string
          host_classroom_id: string | null
          id: string
          paused_on: string | null
          period: string
          source_classroom_id: string | null
          starts_at: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "room_combinations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _assign_planned_room_coverage_checked: {
        Args: {
          p_confirm?: boolean
          p_date: string
          p_end: string
          p_notes?: string
          p_profile: string
          p_room: string
          p_start: string
        }
        Returns: string
      }
      _can_lend_educator: {
        Args: {
          p_end: string
          p_staff: string
          p_start: string
          p_target: string
        }
        Returns: boolean
      }
      _can_lend_existing_coverage: {
        Args: {
          p_assignment: string
          p_end: string
          p_staff: string
          p_start: string
          p_target: string
        }
        Returns: boolean
      }
      _center_registration_code_hash: {
        Args: { p_code: string }
        Returns: string
      }
      _complete_room_transition_effects: {
        Args: { p_plan_id: string }
        Returns: Json
      }
      _compliance_due_items: {
        Args: { p_daycare: string }
        Returns: {
          days_left: number
          due_on: string
          id: string
          kind: string
          title: string
        }[]
      }
      _compliance_inspection_pack: {
        Args: { p_daycare: string }
        Returns: Json
      }
      _compliance_profile_access: {
        Args: { p_daycare: string; p_profile: string; p_write: boolean }
        Returns: boolean
      }
      _compliance_ratio_ledger: { Args: { p_daycare: string }; Returns: Json }
      _coverage_conflict: {
        Args: {
          p_end: string
          p_exclude?: string
          p_room: string
          p_staff: string
          p_start: string
        }
        Returns: string
      }
      _coverage_conflict_without_forecast: {
        Args: {
          p_end: string
          p_exclude?: string
          p_room: string
          p_staff: string
          p_start: string
        }
        Returns: string
      }
      _create_compliance_inspection_share: {
        Args: { p_label: string }
        Returns: Json
      }
      _enrollment_room_projected_occupancy: {
        Args: { p_on_date: string; p_room_id: string }
        Returns: number
      }
      _forecast_children: {
        Args: { p_center: string; p_date: string }
        Returns: {
          arrives_at: string
          child_id: string
          leaves_at: string
          room_id: string
          uncertain: boolean
        }[]
      }
      _forecast_staff_eligible: {
        Args: { p_date: string; p_staff: string }
        Returns: boolean
      }
      _get_coverage_candidates_base: {
        Args: { p_date: string; p_end: string; p_room: string; p_start: string }
        Returns: {
          available: boolean
          full_name: string
          needs_confirmation: boolean
          profile_id: string
          reason: string
        }[]
      }
      _get_mobile_roll_call_without_enrollment_boundary: {
        Args: { p_classroom_id: string }
        Returns: Json
      }
      _loan_live_source_safe: {
        Args: { p_source: string; p_staff: string }
        Returns: boolean
      }
      _log_compliance_drill: {
        Args: {
          p_children_count: number
          p_conducted_local: string
          p_duration_seconds: number
          p_kind: string
          p_lead_staff_id: string
          p_next_due_on?: string
          p_notes?: string
          p_staff_count: number
        }
        Returns: string
      }
      _next_center_open_on_or_after: {
        Args: { p_date: string; p_daycare_id: string }
        Returns: string
      }
      _next_monthly_invoice_date: {
        Args: { p_anchor_day: number; p_current: string }
        Returns: string
      }
      _notify_parent_absence: {
        Args: {
          p_action: string
          p_report: Database["public"]["Tables"]["parent_absence_reports"]["Row"]
        }
        Returns: undefined
      }
      _notify_room_combination_change: {
        Args: { p_daycare: string }
        Returns: undefined
      }
      _operating_room_id: {
        Args: { p_at?: string; p_room: string }
        Returns: string
      }
      _perm: { Args: { a: boolean; e: boolean; v: boolean }; Returns: Json }
      _perms: {
        Args: {
          attendance: Json
          billing: Json
          broadcasts: Json
          children: Json
          daily_logs: Json
          enrollment: Json
          incidents: Json
          medications: Json
          reports: Json
          staff: Json
        }
        Returns: Json
      }
      _read_compliance_inspection_share: {
        Args: { p_document_id?: string; p_token: string }
        Returns: Json
      }
      _record_room_ratio_history: {
        Args: {
          p_classroom_id: string
          p_observed_at?: string
          p_source?: string
        }
        Returns: undefined
      }
      _record_single_room_ratio_history: {
        Args: {
          p_classroom_id: string
          p_observed_at?: string
          p_source?: string
        }
        Returns: undefined
      }
      _refresh_room_ratio_event: {
        Args: { p_allow_notification?: boolean; p_classroom_id: string }
        Returns: undefined
      }
      _refresh_single_room_ratio_event: {
        Args: { p_allow_notification?: boolean; p_classroom_id: string }
        Returns: undefined
      }
      _revoke_compliance_inspection_share: {
        Args: { p_id: string }
        Returns: undefined
      }
      _room_coverage_review_reason: {
        Args: { p_assignment: string }
        Returns: string
      }
      _room_demand_forecast: {
        Args: { p_center: string; p_date: string; p_exclude_staff?: string }
        Returns: {
          ends_at: string
          expected_children: number
          pending_staff: number
          ratio: number
          required_staff: number
          room_id: string
          scheduled_staff: number
          starts_at: string
          uncertain_staff: number
          unknown_bookings: number
        }[]
      }
      _room_ratio_snapshot: {
        Args: { p_classroom_id: string }
        Returns: {
          max_children_per_staff: number
          over_by: number
          present_count: number
          required_staff: number
          staff_count: number
        }[]
      }
      _room_staff_presence: {
        Args: { p_daycare_id: string }
        Returns: {
          effective_classroom_id: string
          full_name: string
          profile_id: string
          staff_member_id: string
        }[]
      }
      _room_transition_capacity: {
        Args: { p_child: string; p_date: string; p_room: string }
        Returns: {
          dependent_moves: number
          offer_holds: number
          projected_children: number
        }[]
      }
      _room_vacancy_offer_candidate: {
        Args: { p_review_id: string }
        Returns: {
          age_months: number
          child_date_of_birth: string
          child_first_name: string
          child_last_name: string
          desired_start_date: string
          enrollment_id: string
          guardian_email: string
          guardian_name: string
          offer_deposit_cents: number
          offer_start_on: string
          offer_tuition_cents: number
          projected_children: number
          waitlist_position: number
          waitlist_priority: string
        }[]
      }
      _save_compliance_document: {
        Args: {
          p_category: string
          p_expires_on?: string
          p_include_in_inspection?: boolean
          p_replaces_id?: string
          p_storage_path: string
          p_title: string
          p_watch_expiry?: boolean
        }
        Returns: string
      }
      _save_room_combination_settings: {
        Args: { p_combinations: Json }
        Returns: undefined
      }
      _scheduled_report_row_count: {
        Args: {
          p_daycare: string
          p_end: string
          p_kind: string
          p_start: string
        }
        Returns: number
      }
      _void_compliance_drill: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      accept_parent_child_invite: {
        Args: { p_code: string; p_relationship?: string }
        Returns: Json
      }
      accept_parent_enrollment_offer: {
        Args: { p_code: string }
        Returns: Json
      }
      accept_staff_invite:
        | { Args: { p_code: string }; Returns: undefined }
        | {
            Args: {
              p_code: string
              p_terms_accepted: boolean
              p_terms_version: string
            }
            Returns: undefined
          }
      bulk_assign_staff_room: {
        Args: { p_classroom_id?: string | null; p_staff_member_ids: string[] }
        Returns: Json
      }
      acknowledge_incident: {
        Args: { p_incident_id: string; p_name: string }
        Returns: undefined
      }
      acknowledge_parent_incident: {
        Args: { p_incident_id: string; p_signed_name: string }
        Returns: Json
      }
      activate_due_enrollment_tuition_rates: {
        Args: { p_daycare_id?: string }
        Returns: number
      }
      add_demo_parent_payment_method: {
        Args: {
          p_brand: string
          p_expiry_month: number
          p_expiry_year: number
          p_last4: string
          p_make_default: boolean
          p_method_type: string
        }
        Returns: Json
      }
      add_enrollment_to_waitlist: {
        Args: {
          p_classroom_id: string
          p_desired_start: string
          p_enrollment_id: string
          p_sibling_priority?: boolean
        }
        Returns: Json
      }
      admin_set_user_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      approve_time_entry: {
        Args: { p_approved: boolean; p_entry_id: string; p_notes?: string }
        Returns: undefined
      }
      assert_rate_limit: {
        Args: {
          p_limit: number
          p_scope: string
          p_subject_suffix?: string
          p_window_seconds: number
        }
        Returns: undefined
      }
      assign_planned_room_coverage: {
        Args: {
          p_confirm?: boolean
          p_date: string
          p_end: string
          p_notes?: string
          p_profile: string
          p_room: string
          p_start: string
        }
        Returns: string
      }
      assign_ratio_floater: {
        Args: {
          p_classroom_id: string
          p_minutes?: number
          p_staff_member_id: string
        }
        Returns: string
      }
      attach_late_pickup_fee_to_invoice: {
        Args: { p_event_id: string; p_invoice_id: string }
        Returns: boolean
      }
      book_admin_enrollment_tour: {
        Args: { p_enrollment_id: string; p_host_id?: string; p_slot_id: string }
        Returns: Json
      }
      book_parent_enrollment_tour: {
        Args: { p_code: string; p_slot_id: string }
        Returns: Json
      }
      bulk_set_moods: {
        Args: { p_log_ids: string[]; p_moods: string[] }
        Returns: undefined
      }
      can_access_billing_family: {
        Args: { p_action?: string; p_family_id: string }
        Returns: boolean
      }
      can_access_child: { Args: { p_child_id: string }; Returns: boolean }
      can_access_child_area: {
        Args: { p_action?: string; p_area: string; p_child_id: string }
        Returns: boolean
      }
      can_access_compliance: { Args: { p_write?: boolean }; Returns: boolean }
      can_access_family: { Args: { p_family_id: string }; Returns: boolean }
      can_access_log: { Args: { p_log_id: string }; Returns: boolean }
      can_access_log_area: {
        Args: { p_action?: string; p_log_id: string }
        Returns: boolean
      }
      can_delete_parent_enrollment_upload: {
        Args: { p_storage_path: string }
        Returns: boolean
      }
      can_delete_unreferenced_parent_document: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_manage_family_billing: {
        Args: { p_family_id: string }
        Returns: boolean
      }
      can_message_family: { Args: { p_family_id: string }; Returns: boolean }
      can_read_parent_document_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_upload_parent_enrollment_document: {
        Args: { p_code: string; p_kind: string }
        Returns: boolean
      }
      can_upload_parent_requested_document: {
        Args: { p_child_id: string; p_daycare_id: string; p_request_id: string }
        Returns: boolean
      }
      can_write_child: { Args: { p_child_id: string }; Returns: boolean }
      can_write_log: { Args: { p_log_id: string }; Returns: boolean }
      cancel_admin_enrollment_tour: {
        Args: { p_enrollment_id: string }
        Returns: Json
      }
      cancel_parent_absence: { Args: { p_report_id: string }; Returns: Json }
      cancel_parent_co_guardian_invite: {
        Args: { p_invite_id: string }
        Returns: boolean
      }
      cancel_parent_data_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      cancel_parent_enrollment_tour: { Args: { p_code: string }; Returns: Json }
      cancel_planned_room_coverage: {
        Args: { p_assignment: string }
        Returns: undefined
      }
      cancel_room_transition_plan: {
        Args: { p_expected_updated_at: string; p_plan_id: string }
        Returns: undefined
      }
      cancel_room_transition_wait_request: {
        Args: { p_expected_updated_at: string; p_request_id: string }
        Returns: undefined
      }
      center_today: { Args: never; Returns: string }
      check_center_registration_code: {
        Args: { p_code: string; p_email: string }
        Returns: {
          center_name: string
          expires_at: string
        }[]
      }
      check_daycare_signup_code: {
        Args: { p_code: string }
        Returns: {
          daycare_id: string
          daycare_name: string
          role: string
        }[]
      }
      child_has_active_consent: {
        Args: { p_child_id: string; p_kind: string }
        Returns: boolean
      }
      child_in_my_daycare: { Args: { p_child_id: string }; Returns: boolean }
      claim_notification_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          available_at: string
          body: string | null
          channel: string
          created_at: string
          daycare_id: string
          dedupe_key: string
          delivered_at: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          provider_response: Json | null
          recipient_email: string | null
          recipient_id: string | null
          status: string
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clock_in: {
        Args: { p_at?: string; p_classroom_id?: string }
        Returns: string
      }
      clock_out: {
        Args: { p_at?: string; p_break_minutes?: number }
        Returns: string
      }
      close_enrollment_inquiry: {
        Args: {
          p_enrollment_id: string
          p_keep_on_file?: boolean
          p_reason: string
          p_send_goodbye?: boolean
        }
        Returns: Json
      }
      complete_center_setup:
        | {
            Args: {
              p_address: string
              p_center_name: string
              p_classrooms?: Json
              p_educator_emails?: Json
              p_phone: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_address: string
              p_center_name: string
              p_classrooms: Json
              p_educator_emails: Json
              p_phone: string
              p_registration_code: string
            }
            Returns: Json
          }
      complete_demo_parent_enrollment_deposit: {
        Args: { p_code: string; p_include_first_month?: boolean }
        Returns: Json
      }
      complete_demo_parent_invoice_payment: {
        Args: { p_invoice_id: string; p_payment_method_id: string }
        Returns: Json
      }
      complete_demo_parent_invoice_payment_group25: {
        Args: { p_invoice_id: string; p_payment_method_id: string }
        Returns: Json
      }
      complete_demo_parent_invoice_payment_internal: {
        Args: { p_invoice_id: string; p_payment_method_id: string }
        Returns: Json
      }
      complete_mobile_late_pickup: {
        Args: { p_notes?: string; p_pass_id: string }
        Returns: {
          billable_minutes: number
          checked_out_at: string
          child_id: string
          child_name: string
          conversation_required: boolean
          fee_cents: number
          late_minutes: number
          late_pickup_event_id: string
          presenter_name: string
          relationship: string
        }[]
      }
      complete_mobile_pickup: {
        Args: { p_pass_id: string }
        Returns: {
          checked_out_at: string
          child_id: string
          child_name: string
          presenter_name: string
          relationship: string
        }[]
      }
      complete_mobile_roll_call: {
        Args: { p_classroom_id: string }
        Returns: Json
      }
      complete_notification_delivery: {
        Args: {
          p_error?: string
          p_id: string
          p_permanent?: boolean
          p_provider_response?: Json
          p_retry_after_seconds?: number
          p_succeeded: boolean
        }
        Returns: undefined
      }
      complete_parent_inquiry_application: {
        Args: { p_code: string }
        Returns: Json
      }
      complete_reviewed_room_transition: {
        Args: { p_expected_updated_at: string; p_plan_id: string }
        Returns: Json
      }
      complete_room_transition_plan: {
        Args: { p_plan_id: string }
        Returns: Json
      }
      consume_rate_limit: {
        Args: {
          p_limit: number
          p_scope: string
          p_subject: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      continue_parent_enrollment_documents: {
        Args: { p_code: string }
        Returns: Json
      }
      convert_room_transition_wait_to_plan: {
        Args: {
          p_expected_updated_at: string
          p_request_id: string
          p_settings: Json
        }
        Returns: string
      }
      correct_attendance_record: {
        Args: {
          p_attendance_id: string
          p_checked_in_at: string
          p_checked_out_at: string
          p_reason: string
          p_source: string
        }
        Returns: string
      }
      create_compliance_inspection_share: {
        Args: { p_label: string }
        Returns: Json
      }
      create_daycare_location: {
        Args: { p_address?: string; p_color?: string; p_location_label: string }
        Returns: string
      }
      create_invoice: {
        Args: {
          p_billed_to: string
          p_child_id: string
          p_due_on: string
          p_lines: Json
        }
        Returns: string
      }
      create_ledger_adjustment: {
        Args: {
          p_amount_cents: number
          p_description: string
          p_entry_type?: string
          p_family_id: string
        }
        Returns: string
      }
      create_mobile_pickup_pass: {
        Args: {
          p_child_id: string
          p_pickup_id?: string
          p_presenter_profile_id?: string
          p_scheduled_for?: string
        }
        Returns: {
          center_name: string
          child_id: string
          child_name: string
          expires_at: string
          manual_code: string
          pass_id: string
          presenter_name: string
          qr_payload: string
          relationship: string
          room_name: string
        }[]
      }
      create_parent_co_guardian_invite: {
        Args: { p_child_id: string; p_email: string; p_relationship?: string }
        Returns: Json
      }
      create_parent_document_request: {
        Args: {
          p_child_id: string
          p_due_on?: string
          p_kind: string
          p_message?: string
          p_title?: string
        }
        Returns: Json
      }
      create_parent_invite: {
        Args: { p_child_id: string; p_email: string; p_relationship?: string }
        Returns: string
      }
      create_pickup: {
        Args: {
          p_child_id: string
          p_full_name: string
          p_phone?: string
          p_relationship?: string
        }
        Returns: string
      }
      create_room_activity_nudge: {
        Args: { p_classroom_id: string; p_mode?: string }
        Returns: Json
      }
      decline_parent_enrollment_offer: {
        Args: { p_code: string; p_reason?: string }
        Returns: Json
      }
      default_role_name: {
        Args: { p_classroom: string; p_job_title: string; p_role: string }
        Returns: string
      }
      delete_my_account: { Args: never; Returns: undefined }
      enqueue_center_notification: {
        Args: {
          p_body?: string
          p_channels?: string[]
          p_classroom_id: string
          p_daycare_id: string
          p_dedupe_key?: string
          p_kind: string
          p_payload?: Json
          p_title: string
        }
        Returns: number
      }
      enqueue_child_notification: {
        Args: {
          p_body?: string
          p_channels?: string[]
          p_child_id: string
          p_dedupe_key?: string
          p_kind: string
          p_payload?: Json
          p_title: string
        }
        Returns: number
      }
      enqueue_compliance_due_reminders: { Args: never; Returns: number }
      enqueue_email_notification: {
        Args: {
          p_body?: string
          p_daycare_id: string
          p_dedupe_key?: string
          p_kind: string
          p_payload?: Json
          p_recipient_email: string
          p_title: string
        }
        Returns: string
      }
      enqueue_room_coverage_review_alerts: { Args: never; Returns: number }
      enqueue_staff_credential_expiry_reminders: {
        Args: never
        Returns: number
      }
      enqueue_system_medication_notification: {
        Args: {
          p_body: string
          p_child_id: string
          p_dedupe_key: string
          p_payload: Json
          p_title: string
        }
        Returns: number
      }
      enroll_from_pipeline: {
        Args: {
          p_classroom_id: string
          p_enrollment_id: string
          p_last_name?: string
        }
        Returns: string
      }
      ensure_family_ledger_account: {
        Args: { p_family_id: string }
        Returns: string
      }
      generate_invite_code: { Args: never; Returns: string }
      generate_parent_offer_code: { Args: never; Returns: string }
      get_announcement_push_tokens: {
        Args: { p_classroom_id?: string; p_daycare_id: string }
        Returns: {
          platform: string
          token: string
        }[]
      }
      get_attendance_range: {
        Args: { p_classroom_id: string; p_end: string; p_start: string }
        Returns: {
          checked_in_at: string
          checked_out_at: string
          child_id: string
          date: string
          first_name: string
          last_name: string
          status: string
        }[]
      }
      get_attendance_week: {
        Args: never
        Returns: {
          absent_count: number
          day: string
          present_count: number
        }[]
      }
      get_billing_summary: {
        Args: never
        Returns: {
          collected_month_cents: number
          expected_month_cents: number
          open_count: number
          outstanding_cents: number
          overdue_count: number
        }[]
      }
      get_center_roles: {
        Args: never
        Returns: {
          base_role: string
          description: string
          id: string
          is_locked: boolean
          is_system: boolean
          member_count: number
          name: string
          permissions: Json
          sort: number
        }[]
      }
      get_classroom_log_status: {
        Args: { p_classroom_id: string; p_date?: string }
        Returns: {
          checked_in_at: string
          checked_out_at: string
          child_id: string
          first_name: string
          last_name: string
          log_id: string
          photo_url: string
          sent_to_parents: boolean
        }[]
      }
      get_compliance_inspection_pack: { Args: never; Returns: Json }
      get_coverage_candidates: {
        Args: { p_date: string; p_end: string; p_room: string; p_start: string }
        Returns: {
          available: boolean
          full_name: string
          needs_confirmation: boolean
          profile_id: string
          reason: string
        }[]
      }
      get_daycare_classrooms: {
        Args: never
        Returns: {
          age_group: string
          child_count: number
          id: string
          name: string
        }[]
      }
      get_daycare_stats: { Args: never; Returns: Json }
      get_daycare_users: {
        Args: never
        Returns: {
          classroom_id: string
          created_at: string
          email: string
          full_name: string
          id: string
          role: string
        }[]
      }
      get_enrollment_fit_check: {
        Args: { p_enrollment_id: string }
        Returns: {
          age_message: string
          age_months: number
          age_status: string
          capacity: number
          capacity_message: string
          capacity_status: string
          classroom_id: string
          coverage_segments: number
          enrollment_id: string
          max_age_months: number
          maximum_educator_gap: number
          min_age_months: number
          projected_children_after: number
          projected_children_before: number
          room_name: string
          staffing_message: string
          staffing_status: string
          start_on: string
          undercovered_segments: number
        }[]
      }
      get_family_ledger_balance: {
        Args: { p_family_id: string }
        Returns: number
      }
      get_inbox_threads: {
        Args: never
        Returns: {
          child_first_name: string
          child_id: string
          child_last_name: string
          conversation_id: string
          family_child_count: number
          family_id: string
          family_name: string
          last_message_at: string
          last_message_body: string
          last_message_from_staff: boolean
          room_name: string
          unread_count: number
        }[]
      }
      get_mobile_child_consents: { Args: { p_child_id: string }; Returns: Json }
      get_mobile_children_photo_consent: {
        Args: { p_child_ids: string[] }
        Returns: {
          allowed: boolean
          child_id: string
        }[]
      }
      get_mobile_classroom_consents: {
        Args: { p_classroom_id: string }
        Returns: Json
      }
      get_mobile_event_rsvp_summary: {
        Args: { p_announcement_id: string }
        Returns: Json
      }
      get_mobile_late_pickup_preview: {
        Args: { p_child_id: string }
        Returns: Json
      }
      get_mobile_roll_call: { Args: { p_classroom_id: string }; Returns: Json }
      get_mobile_room_ratios: {
        Args: never
        Returns: {
          actual_children_per_staff: number
          age_group: string
          alert_after_minutes: number
          alert_ready: boolean
          id: string
          is_over_ratio: boolean
          max_children_per_staff: number
          name: string
          over_by: number
          over_since: string
          present_count: number
          required_staff: number
          staff_count: number
        }[]
      }
      get_mobile_staff_credentials: { Args: never; Returns: Json }
      get_mobile_time_off_status: { Args: never; Returns: Json }
      get_mobile_today_pickups: {
        Args: { p_classroom_id: string }
        Returns: {
          checked_out_at: string
          child_id: string
          child_name: string
          has_active_pass: boolean
          photo_url: string
          pickup_status: string
          presenter_name: string
          primary_guardian_name: string
          primary_guardian_phone: string
          relationship: string
          room_name: string
          scheduled_for: string
        }[]
      }
      get_my_classroom_id: { Args: never; Returns: string }
      get_my_daycare_id: { Args: never; Returns: string }
      get_my_operational_classrooms: {
        Args: never
        Returns: {
          age_group: string
          id: string
          member_room_ids: string[]
          name: string
          temporary: boolean
        }[]
      }
      get_my_role: { Args: never; Returns: string }
      get_my_room_coverage: {
        Args: never
        Returns: {
          ends_at: string
          id: string
          notes: string
          review_issue: string
          review_issue_detected_at: string
          room_id: string
          room_name: string
          starts_at: string
          status: string
          timezone: string
        }[]
      }
      get_nav_badges: {
        Args: never
        Returns: {
          cert_issues: number
          overdue_invoices: number
        }[]
      }
      get_or_create_child_conversation: {
        Args: { p_child_id: string }
        Returns: string
      }
      get_or_create_staff_conversation: {
        Args: { p_other_profile_id: string }
        Returns: string
      }
      get_parent_absence_hub: { Args: { p_child_id: string }; Returns: Json }
      get_parent_account_hub: { Args: never; Returns: Json }
      get_parent_billing_home: { Args: never; Returns: Json }
      get_parent_billing_invoice: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      get_parent_child_details: { Args: { p_child_id: string }; Returns: Json }
      get_parent_documents_hub: { Args: never; Returns: Json }
      get_parent_enrollment_offer: { Args: { p_code: string }; Returns: Json }
      get_parent_enrollment_offer_application_internal: {
        Args: { p_code: string }
        Returns: Json
      }
      get_parent_enrollment_offer_bearer_internal: {
        Args: { p_code: string }
        Returns: Json
      }
      get_parent_incident_hub: { Args: { p_child_id: string }; Returns: Json }
      get_parent_incident_hub_group20_base: {
        Args: { p_child_id: string }
        Returns: Json
      }
      get_parent_inquiry_center: {
        Args: { p_daycare_id: string }
        Returns: Json
      }
      get_parent_inquiry_journey: { Args: { p_code: string }; Returns: Json }
      get_parent_inquiry_journey_application_internal: {
        Args: { p_code: string }
        Returns: Json
      }
      get_parent_invoice_payment_history: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      get_parent_notification_settings: { Args: never; Returns: Json }
      get_parent_payment_receipt: {
        Args: { p_payment_id: string }
        Returns: Json
      }
      get_parent_pickup_options: {
        Args: { p_child_id: string; p_include_removed?: boolean }
        Returns: {
          approval_status: string
          avatar_url: string
          full_name: string
          is_active: boolean
          is_primary: boolean
          phone: string
          relationship: string
          requested_at: string
          review_note: string
          source_id: string
          source_type: string
        }[]
      }
      get_parent_push_tokens: {
        Args: { p_child_id: string }
        Returns: {
          platform: string
          token: string
        }[]
      }
      get_parent_schedule_hub: { Args: never; Returns: Json }
      get_public_center_info: {
        Args: { p_daycare_id: string }
        Returns: {
          name: string
          programs: Json
        }[]
      }
      get_room_coverage_review: {
        Args: { p_date: string }
        Returns: {
          assignment_id: string
          ends_at: string
          full_name: string
          profile_id: string
          reason: string
          room_id: string
          starts_at: string
          status: string
        }[]
      }
      get_room_demand_forecast: {
        Args: { p_date: string }
        Returns: {
          ends_at: string
          expected_children: number
          pending_staff: number
          ratio: number
          required_staff: number
          room_id: string
          scheduled_staff: number
          starts_at: string
          uncertain_staff: number
          unknown_bookings: number
        }[]
      }
      get_room_operating_context: {
        Args: never
        Returns: {
          combination_id: string
          ends_at: string
          host_room_id: string
          host_room_name: string
          live_ratio: number
          member_room_ids: string[]
          room_id: string
        }[]
      }
      get_room_transition_wait_requests: {
        Args: never
        Returns: {
          age_months: number
          child_id: string
          date_of_birth: string
          first_available_day: string
          first_name: string
          from_classroom_id: string
          from_room_name: string
          id: string
          last_name: string
          needs_review: boolean
          not_before: string
          notes: string
          projected_children: number
          room_capacity: number
          source_max_age_months: number
          status_detail: string
          to_classroom_id: string
          to_room_name: string
          updated_at: string
        }[]
      }
      get_room_transitions: {
        Args: { p_horizon_months?: number }
        Returns: {
          age_months: number
          child_id: string
          date_of_birth: string
          first_name: string
          last_name: string
          max_age_months: number
          next_room_id: string
          next_room_name: string
          room_id: string
          room_name: string
        }[]
      }
      get_room_vacancy_reviews: {
        Args: never
        Returns: {
          active_waitlist_count: number
          available_on: string
          blocking_reason: string
          candidate_age_months: number
          candidate_child_date_of_birth: string
          candidate_child_first_name: string
          candidate_child_last_name: string
          candidate_desired_start_date: string
          candidate_enrollment_id: string
          candidate_guardian_email: string
          candidate_guardian_name: string
          candidate_offer_deposit_cents: number
          candidate_offer_start_on: string
          candidate_offer_tuition_cents: number
          candidate_waitlist_position: number
          candidate_waitlist_priority: string
          capacity: number
          classroom_id: string
          daycare_id: string
          id: string
          moved_child_name: string
          projected_children: number
          room_name: string
          source_transition_plan_id: string
          updated_at: string
        }[]
      }
      get_rooms_live_status: {
        Args: never
        Returns: {
          age_group: string
          capacity: number
          educators: Json
          enrolled_count: number
          id: string
          last_log_at: string
          max_age_months: number
          min_age_months: number
          name: string
          present_count: number
          ratio_children_per_educator: number
        }[]
      }
      get_staff_delegations: {
        Args: never
        Returns: {
          access_level: string
          action_count: number
          areas: string[]
          classroom_name: string
          delegate_name: string
          delegate_profile_id: string
          delegate_role: string
          ends_at: string
          granted_by_name: string
          id: string
          revoked_at: string
          revoked_by_name: string
          starts_at: string
        }[]
      }
      get_staff_time_off_coverage_impacts: {
        Args: { p_request_ids: string[] }
        Returns: {
          ends_at: string
          expected_children: number
          request_id: string
          required_staff: number
          room_id: string
          room_name: string
          scheduled_staff: number
          staff_gap: number
          starts_at: string
          uncertain_staff: number
          unknown_bookings: number
          work_date: string
        }[]
      }
      get_staff_invite: {
        Args: { p_code: string }
        Returns: {
          classroom_name: string
          daycare_name: string
          email: string
          expires_at: string
          full_name: string
          invited_by_name: string
          job_title: string
          require_background_check: boolean
          role: string
        }[]
      }
      get_unread_child_message_counts: {
        Args: { p_child_ids?: string[] }
        Returns: {
          child_id: string
          unread_count: number
        }[]
      }
      grant_staff_delegation: {
        Args: {
          p_access_level: string
          p_areas: string[]
          p_delegate_profile_id: string
          p_ends_at: string
        }
        Returns: string
      }
      has_permission: {
        Args: { p_action?: string; p_area: string }
        Returns: boolean
      }
      invite_staff: {
        Args: {
          p_classroom_id?: string
          p_email: string
          p_full_name?: string
          p_job_title?: string
          p_require_background_check?: boolean
          p_role: string
        }
        Returns: string
      }
      resend_staff_invite: {
        Args: { p_invite_id: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      issue_center_registration_code: {
        Args: {
          p_admin_email: string
          p_center_name: string
          p_expires_at?: string
        }
        Returns: {
          admin_email: string
          center_name: string
          expires_at: string
          registration_code: string
        }[]
      }
      join_daycare_with_code: { Args: { p_code: string }; Returns: string }
      kiosk_check: {
        Args: { p_child_id: string; p_pin: string }
        Returns: string
      }
      kiosk_lookup_pin: {
        Args: { p_pin: string }
        Returns: {
          checked_in_at: string
          checked_out_at: string
          child_id: string
          first_name: string
          last_name: string
          pickup_name: string
          room_name: string
        }[]
      }
      link_child_with_code: { Args: { p_code: string }; Returns: string }
      link_parent_enrollment_account: {
        Args: { p_code: string }
        Returns: Json
      }
      list_available_ratio_floaters: {
        Args: { p_classroom_id: string }
        Returns: {
          availability_note: string
          current_classroom_id: string
          current_classroom_name: string
          full_name: string
          profile_id: string
          staff_member_id: string
        }[]
      }
      list_compliance_due_items: {
        Args: never
        Returns: {
          days_left: number
          due_on: string
          id: string
          kind: string
          title: string
        }[]
      }
      list_compliance_inspection_shares: {
        Args: never
        Returns: {
          created_at: string
          expires_at: string
          id: string
          label: string
          last_opened_at: string
          revoked_at: string
        }[]
      }
      list_my_daycare_locations: {
        Args: never
        Returns: {
          address: string
          checked_in_count: number
          color: string
          group_name: string
          id: string
          is_active: boolean
          location_label: string
        }[]
      }
      list_my_staff_conversations: {
        Args: never
        Returns: {
          conversation_id: string
          last_message_at: string
          last_message_body: string
          other_full_name: string
          other_profile_id: string
          other_role: string
          unread_count: number
        }[]
      }
      log_compliance_drill: {
        Args: {
          p_children_count: number
          p_conducted_local: string
          p_duration_seconds: number
          p_kind: string
          p_lead_staff_id: string
          p_next_due_on?: string
          p_notes?: string
          p_staff_count: number
        }
        Returns: string
      }
      mark_messages_read: { Args: { p_child_id: string }; Returns: undefined }
      mark_staff_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: number
      }
      mobile_mark_child_absent: {
        Args: {
          p_child_id: string
          p_note?: string
          p_notify_office?: boolean
          p_reason: string
        }
        Returns: Json
      }
      mobile_roll_call_check_in: { Args: { p_child_id: string }; Returns: Json }
      mobile_workdays_between: {
        Args: { p_ends_on: string; p_starts_on: string }
        Returns: number
      }
      my_child_ids: { Args: never; Returns: string[] }
      my_classroom_ids: { Args: never; Returns: string[] }
      my_family_ids: { Args: never; Returns: string[] }
      my_staff_member_id: { Args: never; Returns: string }
      next_center_open_date: {
        Args: { p_after_date: string; p_daycare_id: string }
        Returns: string
      }
      parent_add_authorized_pickup: {
        Args: {
          p_child_id: string
          p_full_name: string
          p_phone?: string
          p_relationship: string
        }
        Returns: {
          full_name: string
          id: string
          is_active: boolean
          is_primary: boolean
          phone: string
          relationship: string
        }[]
      }
      parent_remove_authorized_pickup: {
        Args: { p_pickup_id: string }
        Returns: undefined
      }
      pause_room_combination_today: {
        Args: { p_id: string; p_paused: boolean }
        Returns: undefined
      }
      preview_parent_child_invite: { Args: { p_code: string }; Returns: Json }
      preview_room_transition: {
        Args: { p_child_id: string; p_from: string; p_room_id: string }
        Returns: {
          available: boolean
          capacity: number
          day: string
          dependent_moves: number
          offer_holds: number
          projected_children: number
          reason: string
        }[]
      }
      process_due_attendance_followups: { Args: never; Returns: number }
      process_due_child_departures: { Args: never; Returns: number }
      process_due_enrollment_invoices: {
        Args: { p_daycare_id?: string }
        Returns: number
      }
      process_due_report_schedules: { Args: never; Returns: number }
      process_expired_enrollment_offers: { Args: never; Returns: number }
      process_medication_authorization_statuses: { Args: never; Returns: Json }
      process_overdue_waitlist_checkins: { Args: never; Returns: number }
      process_room_ratio_history: { Args: never; Returns: number }
      profile_has_permission: {
        Args: { p_action?: string; p_area: string; p_profile_id: string }
        Returns: boolean
      }
      publish_daily_log: { Args: { p_daily_log_id: string }; Returns: Json }
      queue_parent_schedule_notice: {
        Args: {
          p_available_at?: string
          p_body: string
          p_child_id: string
          p_daycare_id: string
          p_dedupe_key: string
          p_in_app?: boolean
          p_payload: Json
          p_title: string
        }
        Returns: number
      }
      re_enroll_alumni: {
        Args: { p_child_id: string; p_classroom_id: string }
        Returns: Json
      }
      read_compliance_inspection_share: {
        Args: { p_document_id?: string; p_token: string }
        Returns: Json
      }
      record_account_security_event: {
        Args: { p_event: string; p_factor_id?: string }
        Returns: undefined
      }
      record_admin_enrollment_tour_outcome: {
        Args: {
          p_enrollment_id: string
          p_notes?: string
          p_outcome: string
          p_send_application?: boolean
        }
        Returns: Json
      }
      record_audit_log_export: {
        Args: { p_row_count: number }
        Returns: undefined
      }
      record_invoice_payment: {
        Args: {
          p_amount_cents: number
          p_invoice_id: string
          p_method?: string
        }
        Returns: string
      }
      reindex_center_waitlist: {
        Args: { p_daycare_id: string }
        Returns: undefined
      }
      remind_mobile_event_nonresponders: {
        Args: { p_announcement_id: string }
        Returns: number
      }
      remove_parent_payment_method: {
        Args: { p_payment_method_id: string }
        Returns: Json
      }
      reopen_parent_enrollment_offer: {
        Args: { p_code: string }
        Returns: Json
      }
      replace_admin_staff_credentials: {
        Args: { p_credentials: Json; p_staff_member_id: string }
        Returns: undefined
      }
      report_parent_absence: {
        Args: {
          p_child_id: string
          p_ends_on: string
          p_note?: string
          p_reason: string
          p_report_id?: string
          p_starts_on: string
        }
        Returns: Json
      }
      report_unauthorized_pickup: {
        Args: {
          p_attempted_name?: string
          p_child_id: string
          p_notes?: string
        }
        Returns: string
      }
      request_enrollment_documents: {
        Args: {
          p_documents: string[]
          p_due_on?: string
          p_enrollment_id: string
          p_message: string
        }
        Returns: Json
      }
      request_fingerprint: { Args: never; Returns: string }
      request_parent_data_action: {
        Args: { p_request_type: string }
        Returns: Json
      }
      request_time_off: {
        Args: {
          p_ends_on: string
          p_kind: string
          p_reason?: string
          p_starts_on: string
        }
        Returns: string
      }
      rerequest_mobile_time_off: {
        Args: {
          p_ends_on: string
          p_kind: string
          p_previous_request_id: string
          p_reason?: string
          p_starts_on: string
        }
        Returns: string
      }
      resend_parent_payment_receipt: {
        Args: { p_payment_id: string }
        Returns: Json
      }
      respond_parent_waitlist_checkin: {
        Args: { p_code: string; p_keep_spot: boolean }
        Returns: Json
      }
      respond_room_activity_nudge: {
        Args: { p_nudge_id: string; p_response: string }
        Returns: {
          classroom_id: string
          created_at: string
          daycare_id: string
          id: string
          message: string
          mode: string
          responded_at: string | null
          responded_by: string | null
          response: string | null
          sent_by: string
          snoozed_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "room_activity_nudges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_to_room_coverage: {
        Args: { p_assignment: string; p_response: string }
        Returns: undefined
      }
      review_parent_authorized_pickup: {
        Args: { p_decision: string; p_note?: string; p_pickup_id: string }
        Returns: string
      }
      review_parent_document_submission: {
        Args: { p_decision: string; p_reason?: string; p_submission_id: string }
        Returns: Json
      }
      review_parent_enrollment_offer: {
        Args: { p_code: string }
        Returns: Json
      }
      review_staff_credential_submission: {
        Args: {
          p_decision: string
          p_review_notes?: string
          p_submission_id: string
        }
        Returns: boolean
      }
      revoke_compliance_inspection_share: {
        Args: { p_id: string }
        Returns: undefined
      }
      revoke_staff_delegation: {
        Args: { p_delegation_id: string }
        Returns: undefined
      }
      save_attendance_bookings: {
        Args: { p_bookings: Json; p_date: string }
        Returns: undefined
      }
      save_compliance_document: {
        Args: {
          p_category: string
          p_expires_on?: string
          p_include_in_inspection?: boolean
          p_replaces_id?: string
          p_storage_path: string
          p_title: string
          p_watch_expiry?: boolean
        }
        Returns: string
      }
      save_enrollment_onboarding: {
        Args: {
          p_cubby_label: string
          p_enrollment_id: string
          p_primary_educator_id: string
          p_send_welcome?: boolean
        }
        Returns: Json
      }
      save_late_pickup_policy: {
        Args: {
          p_conversation_after_count: number
          p_daily_cap_cents: number
          p_fee_per_minute_cents: number
          p_grace_minutes: number
        }
        Returns: string
      }
      save_meal_menu_day: {
        Args: { p_classroom_id: string; p_items: Json; p_menu_date: string }
        Returns: {
          allergens: string[]
          classroom_id: string | null
          created_at: string
          created_by: string | null
          daycare_id: string
          food_description: string
          id: string
          meal_label: string
          meal_time: string
          meal_type: string
          menu_date: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meal_menu_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_parent_enrollment_application: {
        Args: { p_application: Json; p_code: string }
        Returns: Json
      }
      save_parent_enrollment_document: {
        Args: {
          p_code: string
          p_file_name: string
          p_file_size: number
          p_kind: string
          p_mime_type: string
          p_storage_path: string
        }
        Returns: Json
      }
      save_parent_inquiry_application: {
        Args: { p_application: Json; p_code: string }
        Returns: Json
      }
      save_parent_inquiry_document: {
        Args: {
          p_code: string
          p_file_name: string
          p_file_size: number
          p_kind: string
          p_mime_type: string
          p_storage_path: string
        }
        Returns: Json
      }
      save_room_combinations: {
        Args: { p_combinations: Json }
        Returns: undefined
      }
      save_room_coverage_plan: {
        Args: {
          p_date: string
          p_id: string
          p_notify_lead?: boolean
          p_room: string
          p_segments: Json
        }
        Returns: string[]
      }
      save_room_ratio_rules: { Args: { p_rules: Json }; Returns: undefined }
      save_room_settings: {
        Args: {
          p_expected_updated_at?: string
          p_room_id: string
          p_settings: Json
        }
        Returns: string
      }
      save_room_transition_plan: {
        Args: {
          p_expected_updated_at?: string
          p_plan_id?: string
          p_settings: Json
        }
        Returns: string
      }
      save_room_transition_wait_request: {
        Args: {
          p_expected_updated_at?: string
          p_request_id?: string
          p_settings: Json
        }
        Returns: string
      }
      save_staff_regular_schedule: {
        Args: { p_schedule: Json; p_staff_member_id: string }
        Returns: number
      }
      schedule_child_departure: {
        Args: {
          p_child_id: string
          p_last_day: string
          p_notes: string
          p_prepare_spot_review: boolean
          p_reason: string
        }
        Returns: string
      }
      seed_default_roles: { Args: { p_daycare: string }; Returns: undefined }
      send_attendance_followup: {
        Args: {
          p_attendance_date: string
          p_child_id: string
          p_message: string
        }
        Returns: {
          escalation_due_at: string
          followup_id: string
          queued_recipients: number
        }[]
      }
      send_mobile_event_rsvp: {
        Args: {
          p_announcement_id: string
          p_child_id?: string
          p_guests?: number
          p_response: string
        }
        Returns: Json
      }
      send_reviewed_enrollment_offer: {
        Args: {
          p_classroom_id: string
          p_deposit_cents: number
          p_enrollment_id: string
          p_expected_vacancy_updated_at?: string
          p_start_on: string
          p_tuition_cents: number
          p_vacancy_review_id?: string
          p_window_hours: number
        }
        Returns: Json
      }
      send_staff_credential_reminder: {
        Args: { p_credential_id: string; p_remind_again?: boolean }
        Returns: Json
      }
      send_staff_message: {
        Args: { p_body: string; p_conversation_id: string }
        Returns: string
      }
      send_bulk_staff_message: {
        Args: { p_body: string; p_profile_ids: string[] }
        Returns: Json
      }
      send_waitlist_checkins: {
        Args: { p_enrollment_ids: string[]; p_message: string }
        Returns: Json
      }
      set_admin_mfa_requirement: {
        Args: { p_required: boolean }
        Returns: undefined
      }
      set_mobile_parent_consent: {
        Args: { p_child_id: string; p_granted: boolean; p_kind: string }
        Returns: Json
      }
      set_parent_billing_preferences: {
        Args: { p_autopay_enabled: boolean; p_payment_method_id: string }
        Returns: Json
      }
      set_parent_care_data_consent: {
        Args: { p_child_id: string; p_granted: boolean; p_version?: string }
        Returns: Json
      }
      set_parent_notification_preference: {
        Args: { p_enabled: boolean; p_kind: string }
        Returns: boolean
      }
      set_parent_quiet_hours: {
        Args: { p_enabled: boolean; p_end?: string; p_start?: string }
        Returns: Json
      }
      set_planned_shift_break: {
        Args: { p_end?: string; p_shift: string; p_start?: string }
        Returns: undefined
      }
      shares_family_with: { Args: { p_profile_id: string }; Returns: boolean }
      sign_parent_enrollment_agreement: {
        Args: {
          p_acknowledge_policies: boolean
          p_acknowledge_tuition: boolean
          p_code: string
          p_photo_consent: boolean
          p_signature_name: string
        }
        Returns: Json
      }
      staff_is_ratio_eligible: {
        Args: { p_staff_member_id: string }
        Returns: boolean
      }
      start_center: { Args: { p_center_name: string }; Returns: string }
      storage_child_id: { Args: { p_name: string }; Returns: string }
      submit_enrollment_inquiry: {
        Args: {
          p_child_date_of_birth: string
          p_child_first_name: string
          p_classroom_id?: string
          p_daycare_id: string
          p_desired_start?: string
          p_guardian_email: string
          p_guardian_name: string
          p_guardian_phone: string
        }
        Returns: undefined
      }
      submit_enrollment_inquiry_v2: {
        Args: {
          p_child_date_of_birth: string
          p_child_first_name: string
          p_classroom_id: string
          p_daycare_id: string
          p_days_per_week: number
          p_desired_start: string
          p_guardian_email: string
          p_guardian_name: string
          p_guardian_phone: string
        }
        Returns: string
      }
      submit_mobile_credential_renewal: {
        Args: {
          p_completed_on: string
          p_credential_id: string
          p_credential_number: string
          p_expires_on: string
          p_file_name: string
          p_issuer: string
          p_mime_type: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      submit_parent_document_request: {
        Args: {
          p_file_name: string
          p_mime_type: string
          p_request_id: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: Json
      }
      submit_parent_enrollment_inquiry: {
        Args: {
          p_child_date_of_birth: string
          p_child_full_name: string
          p_classroom_id: string
          p_daycare_id: string
          p_days_per_week: number
          p_desired_start: string
          p_guardian_email: string
          p_guardian_name: string
          p_guardian_phone: string
        }
        Returns: Json
      }
      switch_daycare_location: {
        Args: { p_daycare_id: string }
        Returns: undefined
      }
      sync_staff_certifications_json: {
        Args: { p_staff_member_id: string }
        Returns: undefined
      }
      update_enrollment_waitlist_rules: {
        Args: {
          p_auto_archive_checkins: number
          p_auto_offer: boolean
          p_offer_window_hours: number
          p_siblings_first: boolean
          p_staff_children_next: boolean
        }
        Returns: Json
      }
      update_parent_profile: {
        Args: {
          p_avatar_url?: string
          p_display_name: string
          p_full_name: string
          p_phone?: string
        }
        Returns: Json
      }
      verify_mobile_pickup_pass: {
        Args: {
          p_code?: string
          p_expected_child_id?: string
          p_token?: string
        }
        Returns: {
          child_id: string
          child_name: string
          expires_at: string
          pass_id: string
          photo_url: string
          presenter_name: string
          relationship: string
          room_name: string
        }[]
      }
      void_compliance_drill: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      withdraw_enrollment_offer: {
        Args: {
          p_enrollment_id: string
          p_keep_on_waitlist: boolean
          p_reason: string
        }
        Returns: Json
      }
      withdraw_mobile_credential_submission: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      withdraw_mobile_time_off_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
