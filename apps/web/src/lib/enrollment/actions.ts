"use server";

import {
  createEnrollment,
  enrollFromPipeline,
  getMyProfile,
  setEnrollmentStage,
  submitEnrollmentInquiry,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface EnrollmentActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
  journeyCode?: string;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function newInquiryAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const guardianName = str(formData, "guardian_name");
  if (!guardianName) return { error: "The family name is required." };

  try {
    const classroomId = str(formData, "classroom_id") || null;
    const skipToWaitlist = formData.get("skip_to_waitlist") === "on";
    let waitlistPosition: number | null = null;
    if (skipToWaitlist && classroomId) {
      const { count, error: countError } = await supabase
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .in("waitlist_status", ["active", "offer"]);
      if (countError) throw countError;
      waitlistPosition = (count ?? 0) + 1;
    }
    const guardianEmail = str(formData, "guardian_email") || null;
    const childFirstName = str(formData, "child_first_name") || null;
    const enrollmentId = await createEnrollment(supabase, {
      daycare_id: profile.daycare_id,
      classroom_id: classroomId,
      guardian_name: guardianName,
      guardian_email: guardianEmail,
      guardian_phone: str(formData, "guardian_phone") || null,
      child_first_name: childFirstName,
      child_date_of_birth: str(formData, "child_date_of_birth") || null,
      desired_start_date: str(formData, "desired_start") || null,
      source: str(formData, "source") || "walk-in",
      waitlist_position: waitlistPosition,
      waitlist_status: skipToWaitlist ? "active" : "not_waitlisted",
      waitlist_joined_at: skipToWaitlist ? new Date().toISOString() : null,
    });
    await enqueueEnrollmentEmail(
      supabase,
      profile.daycare_id,
      guardianEmail,
      "enrollment_inquiry_received",
      "We received your enrollment inquiry",
      `${guardianName}, thanks for reaching out about ${childFirstName ?? "your family"}. We'll follow up with available tour times.`,
      `inquiry:${enrollmentId}`,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add the inquiry." };
  }

  revalidatePath("/enrollment");
  return { ok: true };
}

export async function setStageAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  await setEnrollmentStage(supabase, str(formData, "enrollment_id"), str(formData, "stage"));
  revalidatePath("/enrollment");
}

export async function enrollAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();

  const classroomId = str(formData, "classroom_id");
  const lastName = str(formData, "last_name");
  if (!lastName) {
    return {
      error: "Enter the child's last name.",
      fieldErrors: { last_name: "Child's last name is required." },
    };
  }
  if (!classroomId) return { error: "The accepted offer does not have a room." };

  try {
    await enrollFromPipeline(
      supabase,
      str(formData, "enrollment_id"),
      classroomId,
      lastName,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not enroll." };
  }

  revalidatePath("/enrollment");
  revalidatePath("/children");
  return { ok: true };
}

export async function saveEnrollmentOnboardingAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  const primaryEducatorId = str(formData, "primary_educator_id");
  const cubbyLabel = str(formData, "cubby_label");

  const fieldErrors: Record<string, string> = {};
  if (!primaryEducatorId) fieldErrors.primary_educator_id = "Choose a primary educator.";
  if (!cubbyLabel) fieldErrors.cubby_label = "Enter the child's cubby label.";
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Complete the highlighted room setup fields.", fieldErrors };
  }

  const { error } = await supabase.rpc("save_enrollment_onboarding", {
    p_enrollment_id: enrollmentId,
    p_primary_educator_id: primaryEducatorId,
    p_cubby_label: cubbyLabel,
    p_send_welcome: formData.get("send_welcome") === "on",
  });
  if (error) return { error: error.message };

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  revalidatePath("/children");
  return { ok: true };
}

export async function createTourSlotAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const date = str(formData, "date");
  const time = str(formData, "time");
  const timeZone = str(formData, "time_zone") || "America/Toronto";
  if (!date || !time) return { error: "Choose a tour date and time." };
  const startsAt = zonedLocalToIso(date, time, timeZone);
  const endsAt = new Date(new Date(startsAt).getTime() + 45 * 60000).toISOString();
  const { error } = await supabase.from("enrollment_tour_slots").insert({
    daycare_id: profile.daycare_id,
    starts_at: startsAt,
    ends_at: endsAt,
    classroom_id: str(formData, "classroom_id") || null,
    host_id: str(formData, "host_id") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function cancelTourSlotAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("enrollment_tour_slots")
    .update({ status: "cancelled" })
    .eq("id", str(formData, "slot_id"));
  if (error) throw error;
  revalidatePath("/enrollment");
}

export async function bookTourAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const slotId = str(formData, "slot_id");
  const hostId = str(formData, "host_id") || null;
  if (!enrollmentId || !slotId) return { error: "Choose a family and an open slot." };
  const { error } = await supabase.rpc("book_admin_enrollment_tour", {
    p_enrollment_id: enrollmentId,
    p_slot_id: slotId,
    p_host_id: hostId ?? undefined,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function cancelEnrollmentTourAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  if (!enrollmentId) throw new Error("Enrollment is required.");

  const { error } = await supabase.rpc("cancel_admin_enrollment_tour", {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw error;

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
}

export async function logTourOutcomeAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  const outcome = str(formData, "outcome");
  if (!enrollmentId || !["attended", "no_show", "rescheduled"].includes(outcome)) {
    return { error: "Choose a tour outcome." };
  }
  const { error } = await supabase.rpc("record_admin_enrollment_tour_outcome", {
    p_enrollment_id: enrollmentId,
    p_outcome: outcome,
    p_notes: str(formData, "notes") || undefined,
    p_send_application: formData.get("send_application") === "on",
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function requestDocumentsAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  const requested = formData.getAll("documents").map(String);
  if (requested.length === 0) return { error: "Select at least one missing document." };
  const message = str(formData, "message");
  if (!message) return { error: "Write a message for the family." };
  const { error } = await supabase.rpc("request_enrollment_documents", {
    p_enrollment_id: enrollmentId,
    p_documents: requested,
    p_message: message,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function messageEnrollmentFamilyAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };

  const enrollmentId = str(formData, "enrollment_id");
  const body = str(formData, "message").slice(0, 5000);
  const subject = str(formData, "subject").slice(0, 140) || "A message from Sunny Grove";
  if (!enrollmentId || !body) return { error: "Write a message first." };

  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .select("guardian_email")
    .eq("id", enrollmentId)
    .single();
  if (error) return { error: error.message };
  if (!enrollment.guardian_email) return { error: "This application has no contact email." };

  try {
    await enqueueEnrollmentEmail(
      supabase,
      profile.daycare_id,
      enrollment.guardian_email,
      "enrollment_message",
      subject,
      body,
      `enrollment-message:${enrollmentId}:${new Date().toISOString()}`,
    );
  } catch (sendError) {
    return { error: sendError instanceof Error ? sendError.message : "Could not send the message." };
  }

  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function sendOfferAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const classroomId = str(formData, "classroom_id");
  const startDate = str(formData, "desired_start");
  const windowHours = Number(str(formData, "offer_window_hours") || 48);
  const tuitionCents = Math.round(Number(str(formData, "tuition")) * 100);
  const depositCents = Math.round(Number(str(formData, "deposit")) * 100);
  const vacancyReviewId = str(formData, "vacancy_review_id") || null;
  const expectedVacancyUpdatedAt = str(formData, "expected_vacancy_updated_at") || null;
  if (
    !enrollmentId || !classroomId || !startDate || !Number.isFinite(windowHours)
    || !Number.isFinite(tuitionCents) || !Number.isFinite(depositCents)
  ) {
    return { error: "Choose the room, first day and offer window." };
  }
  const { error } = await supabase.rpc("send_reviewed_enrollment_offer", {
    p_enrollment_id: enrollmentId,
    p_classroom_id: classroomId,
    p_start_on: startDate,
    p_window_hours: windowHours,
    p_tuition_cents: tuitionCents,
    p_deposit_cents: depositCents,
    ...(vacancyReviewId ? { p_vacancy_review_id: vacancyReviewId } : {}),
    ...(expectedVacancyUpdatedAt
      ? { p_expected_vacancy_updated_at: expectedVacancyUpdatedAt }
      : {}),
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function nudgeOfferAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const extend = formData.get("extend_offer") === "on";
  const { data: current, error: readError } = await supabase
    .from("enrollments")
    .select("guardian_email, guardian_name, child_first_name, offer_expires_at, offer_nudged_at")
    .eq("id", enrollmentId)
    .single();
  if (readError) return { error: readError.message };
  if (current.offer_nudged_at && !extend) return { error: "This offer already received its friendly reminder." };
  const expiresAt = extend
    ? new Date(new Date(current.offer_expires_at ?? Date.now()).getTime() + 48 * 3600000).toISOString()
    : current.offer_expires_at;
  const { error } = await supabase
    .from("enrollments")
    .update({ offer_nudged_at: new Date().toISOString(), offer_expires_at: expiresAt })
    .eq("id", enrollmentId);
  if (error) return { error: error.message };
  await enqueueEnrollmentEmail(
    supabase,
    profile.daycare_id,
    current.guardian_email,
    "offer_reminder",
    `Reminder: ${current.child_first_name ?? "your"} spot is being held`,
    str(formData, "message") || `${current.guardian_name ?? "Hello"}, your Sunny Grove offer is waiting for you.`,
    `offer-nudge:${enrollmentId}`,
  );
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function addToWaitlistAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const classroomId = str(formData, "classroom_id");
  const desiredStart = str(formData, "desired_start");
  if (!enrollmentId || !classroomId) return { error: "Choose a family and room." };
  if (!desiredStart) return { error: "Choose the family's desired start date." };
  const { error } = await supabase.rpc("add_enrollment_to_waitlist", {
    p_enrollment_id: enrollmentId,
    p_classroom_id: classroomId,
    p_desired_start: desiredStart,
    p_sibling_priority: formData.get("sibling_priority") === "on",
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function withdrawOfferAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  const keep = formData.get("keep_on_waitlist") === "on";
  const reason = str(formData, "reason");
  if (!enrollmentId) return { error: "Choose an open offer." };
  if (!reason) return { error: "Choose a withdrawal reason." };

  const { error } = await supabase.rpc("withdraw_enrollment_offer", {
    p_enrollment_id: enrollmentId,
    p_keep_on_waitlist: keep,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function updateWaitlistRulesAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const offerWindowHours = Number(str(formData, "offer_window_hours") || 48);
  const autoArchiveCheckins = Number(str(formData, "auto_archive_checkins") || 2);
  if (!Number.isInteger(offerWindowHours) || offerWindowHours < 12 || offerWindowHours > 336) {
    return { error: "Offer window must be between 12 and 336 hours." };
  }
  if (!Number.isInteger(autoArchiveCheckins) || autoArchiveCheckins < 1 || autoArchiveCheckins > 10) {
    return { error: "Stale-entry threshold must be between 1 and 10 check-ins." };
  }
  const { error } = await supabase.rpc("update_enrollment_waitlist_rules", {
    p_siblings_first: formData.get("siblings_first") === "on",
    p_staff_children_next: formData.get("staff_children_next") === "on",
    p_offer_window_hours: offerWindowHours,
    p_auto_offer: formData.get("auto_offer") === "on",
    p_auto_archive_checkins: autoArchiveCheckins,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function closeInquiryAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  const goodbye = formData.get("send_goodbye") === "on";
  const keep = formData.get("keep_on_file") === "on";
  const reason = str(formData, "reason");
  if (!enrollmentId) return { error: "Choose an inquiry to close." };
  if (!reason) return { error: "Choose a closure reason." };
  const { error } = await supabase.rpc("close_enrollment_inquiry", {
    p_enrollment_id: enrollmentId,
    p_reason: reason,
    p_send_goodbye: goodbye,
    p_keep_on_file: keep,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function sendWaitlistCheckinAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const ids = formData.getAll("enrollment_id").map(String);
  if (ids.length === 0) return { error: "Select at least one family." };
  const message = str(formData, "message");
  if (!message) return { error: "Enter a check-in message." };
  const { error } = await supabase.rpc("send_waitlist_checkins", {
    p_enrollment_ids: ids,
    p_message: message,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function scheduleChildWithdrawalAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  const lastDay = str(formData, "last_day");
  const reason = str(formData, "reason");
  if (!childId || !lastDay || !reason) return { error: "Child, last day and reason are required." };
  const { error } = await supabase.rpc("schedule_child_departure", {
    p_child_id: childId,
    p_last_day: lastDay,
    p_reason: reason,
    p_notes: str(formData, "notes"),
    p_prepare_spot_review: formData.get("auto_offer_spot") === "on",
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  revalidatePath("/children");
  return { ok: true };
}

export async function reEnrollAlumniAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const childId = str(formData, "child_id");
  const classroomId = str(formData, "classroom_id");
  if (!childId || !classroomId) return { error: "Choose the child's new room." };
  const { error } = await supabase.rpc("re_enroll_alumni", {
    p_child_id: childId,
    p_classroom_id: classroomId,
  });
  if (error) return { error: error.message };
  revalidatePath("/enrollment");
  revalidatePath("/children");
  revalidatePath("/rooms");
  return { ok: true };
}

// Public form (2g) — no session; the anon client calls the definer RPC.
export async function publicInquiryAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();

  const name = str(formData, "guardian_name");
  const email = str(formData, "guardian_email");
  const childFullName = str(formData, "child_full_name");
  if (!name || !email || !childFullName) {
    return { error: "Your name, email, and the child's full name are required." };
  }
  const birthday = str(formData, "child_date_of_birth");
  const desiredStart = str(formData, "desired_start");

  try {
    const inquiry = await submitEnrollmentInquiry(supabase, {
      daycareId: str(formData, "daycare_id"),
      guardianName: name,
      guardianEmail: email,
      guardianPhone: str(formData, "guardian_phone") || undefined,
      childFullName,
      childDateOfBirth: birthday ? `${birthday}-01` : undefined,
      classroomId: str(formData, "classroom_id") || undefined,
      desiredStart: desiredStart ? `${desiredStart}-01` : undefined,
      daysPerWeek: Number(str(formData, "days_per_week") || 5),
    });
    return { ok: true, journeyCode: inquiry.journeyCode };
  } catch (error) {
    console.error("[public-inquiry]", error);
    return {
      error:
        process.env.NODE_ENV === "development" && error instanceof Error
          ? error.message
          : "Something went wrong — please try again or call us.",
    };
  }

}

async function enqueueEnrollmentEmail(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  daycareId: string,
  email: string | null,
  kind: string,
  title: string,
  body: string,
  dedupeKey: string,
) {
  if (!email) return;
  const { error } = await supabase.rpc("enqueue_email_notification", {
    p_daycare_id: daycareId,
    p_recipient_email: email,
    p_kind: kind,
    p_title: title,
    p_body: body,
    p_payload: { route: "/enrollment" },
    p_dedupe_key: dedupeKey,
  });
  if (error) throw error;
}

function zonedLocalToIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return new Date(utcGuess - (represented - utcGuess)).toISOString();
}
