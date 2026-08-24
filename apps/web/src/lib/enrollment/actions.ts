"use server";

import {
  createEnrollment,
  enrollFromPipeline,
  getMyProfile,
  setEnrollmentStage,
  submitEnrollmentInquiry,
} from "@dailylog/db/queries";
import type { Json } from "@dailylog/db";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export interface EnrollmentActionState {
  error?: string;
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
  if (!classroomId) return { error: "Pick a room." };

  try {
    await enrollFromPipeline(
      supabase,
      str(formData, "enrollment_id"),
      classroomId,
      str(formData, "last_name") || undefined,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not enroll." };
  }

  revalidatePath("/enrollment");
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

  const { data: currentEnrollment, error: currentEnrollmentError } = await supabase
    .from("enrollments")
    .select("stage")
    .eq("id", enrollmentId)
    .single();
  if (currentEnrollmentError) return { error: currentEnrollmentError.message };

  const { data: slot, error: slotError } = await supabase
    .from("enrollment_tour_slots")
    .select("id, starts_at, status, classroom_id")
    .eq("id", slotId)
    .single();
  if (slotError || slot.status !== "open") return { error: "That tour slot is no longer open." };

  const { error: slotUpdateError } = await supabase
    .from("enrollment_tour_slots")
    .update({ enrollment_id: enrollmentId, host_id: hostId, status: "booked" })
    .eq("id", slotId)
    .eq("status", "open");
  if (slotUpdateError) return { error: slotUpdateError.message };

  // A reschedule releases the previous booking after the replacement slot is
  // secured, so the calendar never loses both reservations on a failed write.
  const { error: previousSlotError } = await supabase
    .from("enrollment_tour_slots")
    .update({ enrollment_id: null, host_id: null, status: "open" })
    .eq("enrollment_id", enrollmentId)
    .eq("status", "booked")
    .neq("id", slotId);
  if (previousSlotError) {
    await supabase
      .from("enrollment_tour_slots")
      .update({ enrollment_id: null, host_id: null, status: "open" })
      .eq("id", slotId);
    return { error: previousSlotError.message };
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from("enrollments")
    .update({
      stage: currentEnrollment.stage === "inquiry" ? "tour" : currentEnrollment.stage,
      stage_changed_at: new Date().toISOString(),
      tour_at: slot.starts_at,
      tour_host_id: hostId,
      classroom_id: slot.classroom_id,
    })
    .eq("id", enrollmentId)
    .select("guardian_email, guardian_name, child_first_name, offer_code")
    .single();
  if (enrollmentError) return { error: enrollmentError.message };
  await enqueueEnrollmentEmail(
    supabase,
    profile.daycare_id,
    enrollment.guardian_email,
    "tour_confirmation",
    "Your Sunny Grove tour is booked",
    `${enrollment.guardian_name ?? "Hello"}, your tour for ${enrollment.child_first_name ?? "your family"} is confirmed for ${formatDateTime(slot.starts_at)}. View or reschedule it in DailyLog: dailylog://inquiry?code=${encodeURIComponent(enrollment.offer_code ?? "")}`,
    `tour:${enrollmentId}:${slot.starts_at}`,
  );
  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function cancelEnrollmentTourAction(formData: FormData): Promise<void> {
  const supabase = await getServerSupabase();
  const enrollmentId = str(formData, "enrollment_id");
  if (!enrollmentId) throw new Error("Enrollment is required.");

  const { error: slotError } = await supabase
    .from("enrollment_tour_slots")
    .update({ enrollment_id: null, host_id: null, status: "open" })
    .eq("enrollment_id", enrollmentId)
    .eq("status", "booked");
  if (slotError) throw slotError;

  const { error } = await supabase
    .from("enrollments")
    .update({ tour_at: null, tour_host_id: null, tour_outcome: "cancelled" })
    .eq("id", enrollmentId);
  if (error) throw error;

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
}

export async function logTourOutcomeAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const outcome = str(formData, "outcome");
  if (!enrollmentId || !["attended", "no_show", "rescheduled"].includes(outcome)) {
    return { error: "Choose a tour outcome." };
  }
  const sendApplication = formData.get("send_application") === "on";
  const values = {
    tour_outcome: outcome,
    tour_notes: str(formData, "notes") || null,
    ...(outcome === "attended" && sendApplication
      ? { stage: "application", stage_changed_at: new Date().toISOString(), application_progress: 20 }
      : {}),
  };
  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .update(values)
    .eq("id", enrollmentId)
    .select("guardian_email, guardian_name, child_first_name, offer_code")
    .single();
  if (error) return { error: error.message };
  if (outcome === "attended" && sendApplication) {
    await enqueueEnrollmentEmail(
      supabase,
      profile.daycare_id,
      enrollment.guardian_email,
      "enrollment_application",
      `Application for ${enrollment.child_first_name ?? "Sunny Grove"}`,
      `${enrollment.guardian_name ?? "Hello"}, thanks for visiting. Your enrollment application is ready to complete.`,
      `application:${enrollmentId}`,
    );
  }
  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${enrollmentId}`);
  return { ok: true };
}

export async function requestDocumentsAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const requested = formData.getAll("documents").map(String);
  if (requested.length === 0) return { error: "Select at least one missing document." };
  const { data: enrollment, error: readError } = await supabase
    .from("enrollments")
    .select("documents_status, guardian_email, guardian_name, child_first_name, child_id")
    .eq("id", enrollmentId)
    .single();
  if (readError) return { error: readError.message };
  const message = str(formData, "message") || `${enrollment.guardian_name ?? "Hello"}, please upload the remaining enrollment documents.`;

  // Once the application has become an enrolled child, keep the request in the
  // standing parent document vault as well as the historical application record.
  if (enrollment.child_id) {
    const titles: Record<string, string> = {
      immunization: "Updated immunization record",
      birth_certificate: "Birth certificate",
      custody: "Custody document",
      allergy_medical: "Allergy & medical form",
    };
    const dueOn = new Date();
    dueOn.setDate(dueOn.getDate() + 14);
    for (const document of requested) {
      const { error: requestError } = await supabase.rpc("create_parent_document_request", {
        p_child_id: enrollment.child_id,
        p_kind: document,
        p_title: titles[document] ?? document.replaceAll("_", " "),
        p_message: message,
        p_due_on: dueOn.toISOString().slice(0, 10),
      });
      if (requestError) return { error: requestError.message };
    }
  }
  const statuses = jsonObject(enrollment.documents_status);
  for (const document of requested) statuses[document] = "requested";
  const { error } = await supabase
    .from("enrollments")
    .update({ documents_status: statuses })
    .eq("id", enrollmentId);
  if (error) return { error: error.message };
  await enqueueEnrollmentEmail(
    supabase,
    profile.daycare_id,
    enrollment.guardian_email,
    "enrollment_documents",
    `Documents needed for ${enrollment.child_first_name ?? "your application"}`,
    message,
    `documents:${enrollmentId}:${requested.sort().join("-")}`,
  );
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
  if (!enrollmentId || !classroomId || !startDate || !Number.isFinite(windowHours)) {
    return { error: "Choose the room, first day and offer window." };
  }
  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + windowHours * 3600000);
  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .update({
      classroom_id: classroomId,
      desired_start_date: startDate,
      stage: "offer",
      stage_changed_at: sentAt.toISOString(),
      offer_sent_at: sentAt.toISOString(),
      offer_expires_at: expiresAt.toISOString(),
      offer_status: "sent",
      offer_deposit_cents: Math.round(Number(str(formData, "deposit")) * 100),
      offer_tuition_cents: Math.round(Number(str(formData, "tuition")) * 100),
      waitlist_status: "offer",
    })
    .eq("id", enrollmentId)
    .select("guardian_email, guardian_name, child_first_name, offer_code")
    .single();
  if (error) return { error: error.message };
  await enqueueEnrollmentEmail(
    supabase,
    profile.daycare_id,
    enrollment.guardian_email,
    "waitlist_offer",
    `${enrollment.child_first_name ?? "Your family"} has a spot at Sunny Grove`,
    `${enrollment.guardian_name ?? "Hello"}, your enrollment offer is held until ${formatDateTime(expiresAt.toISOString())}. Open it securely in DailyLog: dailylog://offer?code=${encodeURIComponent(enrollment.offer_code ?? "")}`,
    `offer:${enrollmentId}:${sentAt.toISOString().slice(0, 13)}`,
  );
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
  if (!enrollmentId || !classroomId) return { error: "Choose a family and room." };
  const priority = formData.get("sibling_priority") === "on" ? "sibling" : "public";
  const [{ data: waitlist, error: listError }, { data: settings }] = await Promise.all([
    supabase
    .from("enrollments")
    .select("id, waitlist_priority, waitlist_status, waitlist_joined_at, created_at, guardian_email, guardian_name, child_first_name")
    .in("waitlist_status", ["active", "offer"]),
    supabase.from("enrollment_settings").select("siblings_first, staff_children_next").maybeSingle(),
  ]);
  if (listError) return { error: listError.message };
  const joinedAt = new Date().toISOString();
  const ranked = [
    ...(waitlist ?? []),
    { id: enrollmentId, waitlist_priority: priority, waitlist_status: "active", waitlist_joined_at: joinedAt, created_at: joinedAt, guardian_email: null, guardian_name: null, child_first_name: null },
  ].sort((a, b) => waitlistSort(a, b, settings ?? undefined));
  for (let index = 0; index < ranked.length; index++) {
    const isNew = ranked[index].id === enrollmentId;
    const { error } = await supabase
      .from("enrollments")
      .update({
        ...(isNew ? { classroom_id: classroomId, waitlist_status: "active" } : {}),
        waitlist_priority: ranked[index].waitlist_priority,
        waitlist_joined_at: ranked[index].waitlist_joined_at ?? ranked[index].created_at,
        waitlist_position: index + 1,
      })
      .eq("id", ranked[index].id);
    if (error) return { error: error.message };
  }
  const { data: added } = await supabase
    .from("enrollments")
    .select("guardian_email, guardian_name, child_first_name, offer_code")
    .eq("id", enrollmentId)
    .single();
  if (added) {
    const position = ranked.findIndex((item) => item.id === enrollmentId) + 1;
    await enqueueEnrollmentEmail(
      supabase,
      profile.daycare_id,
      added.guardian_email,
      "waitlist_confirmation",
      `${added.child_first_name ?? "Your family"} is on the waitlist`,
      `${added.guardian_name ?? "Hello"}, your center-wide waitlist position is #${position}. Track your place in DailyLog: dailylog://inquiry?code=${encodeURIComponent(added.offer_code ?? "")}`,
      `waitlist-added:${enrollmentId}`,
    );
  }
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function withdrawOfferAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const keep = formData.get("keep_on_waitlist") === "on";
  const { data: current, error: readError } = await supabase
    .from("enrollments")
    .select("classroom_id, guardian_email, child_first_name")
    .eq("id", enrollmentId)
    .single();
  if (readError) return { error: readError.message };
  const { error } = await supabase
    .from("enrollments")
    .update({
      offer_status: "withdrawn",
      stage: keep ? "inquiry" : "withdrawn",
      stage_changed_at: new Date().toISOString(),
      waitlist_status: keep ? "active" : "archived",
      waitlist_priority: keep ? "public" : undefined,
      waitlist_joined_at: keep ? new Date().toISOString() : undefined,
      closed_reason: str(formData, "reason") || "Offer withdrawn",
      closed_at: keep ? null : new Date().toISOString(),
    })
    .eq("id", enrollmentId);
  if (error) return { error: error.message };

  const { data: settings } = await supabase
    .from("enrollment_settings")
    .select("auto_offer, offer_window_hours, siblings_first, staff_children_next")
    .maybeSingle();
  if (settings?.auto_offer && current.classroom_id) {
    const { data: next } = await supabase
      .from("enrollments")
      .select("id, guardian_email, guardian_name, child_first_name")
      .eq("classroom_id", current.classroom_id)
      .eq("waitlist_status", "active")
      .neq("id", enrollmentId)
      .order("waitlist_position")
      .limit(1)
      .maybeSingle();
    if (next) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (settings.offer_window_hours ?? 48) * 3600000);
      await supabase.from("enrollments").update({
        stage: "offer",
        stage_changed_at: now.toISOString(),
        offer_status: "sent",
        offer_sent_at: now.toISOString(),
        offer_expires_at: expiresAt.toISOString(),
        waitlist_status: "offer",
      }).eq("id", next.id);
      await enqueueEnrollmentEmail(
        supabase,
        profile.daycare_id,
        next.guardian_email,
        "waitlist_offer",
        `${next.child_first_name ?? "Your family"} has a spot at Sunny Grove`,
        `${next.guardian_name ?? "Hello"}, a matching room spot is held until ${formatDateTime(expiresAt.toISOString())}.`,
        `auto-offer:${next.id}:${now.toISOString().slice(0, 13)}`,
      );
    }
  }
  const { data: remaining } = await supabase
    .from("enrollments")
    .select("id, waitlist_priority, waitlist_joined_at, created_at")
    .in("waitlist_status", ["active", "offer"]);
  (remaining ?? []).sort((a, b) => waitlistSort(a, b, settings ?? undefined));
  for (let index = 0; index < (remaining ?? []).length; index++) {
    await supabase.from("enrollments").update({ waitlist_position: index + 1 }).eq("id", remaining![index].id);
  }
  await enqueueEnrollmentEmail(
    supabase,
    profile.daycare_id,
    current.guardian_email,
    "offer_withdrawn",
    `Update about ${current.child_first_name ?? "your"} enrollment offer`,
    "Your Sunny Grove offer has been closed. Your family record remains safely on file.",
    `offer-withdrawn:${enrollmentId}`,
  );
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function updateWaitlistRulesAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const { error } = await supabase.from("enrollment_settings").upsert({
    daycare_id: profile.daycare_id,
    siblings_first: formData.get("siblings_first") === "on",
    staff_children_next: formData.get("staff_children_next") === "on",
    offer_window_hours: Number(str(formData, "offer_window_hours") || 48),
    auto_offer: formData.get("auto_offer") === "on",
    auto_archive_checkins: Number(str(formData, "auto_archive_checkins") || 2),
  });
  if (error) return { error: error.message };
  const siblingsFirst = formData.get("siblings_first") === "on";
  const staffChildrenNext = formData.get("staff_children_next") === "on";
  const { data: active, error: activeError } = await supabase
    .from("enrollments")
    .select("id, waitlist_position, waitlist_priority, waitlist_joined_at, created_at, guardian_email, guardian_name, child_first_name")
    .in("waitlist_status", ["active", "offer"]);
  if (activeError) return { error: activeError.message };
  const ranked = (active ?? []).sort((a, b) =>
    waitlistSort(a, b, {
      siblings_first: siblingsFirst,
      staff_children_next: staffChildrenNext,
    }),
  );
  for (let index = 0; index < ranked.length; index++) {
    const nextPosition = index + 1;
    await supabase.from("enrollments").update({ waitlist_position: nextPosition }).eq("id", ranked[index].id);
    if (ranked[index].waitlist_position !== nextPosition) {
      await enqueueEnrollmentEmail(
        supabase,
        profile.daycare_id,
        ranked[index].guardian_email,
        "waitlist_position_changed",
        "Your waitlist position changed",
        `${ranked[index].guardian_name ?? "Hello"}, ${ranked[index].child_first_name ?? "your family"} is now #${nextPosition} after the center updated its ranking rules.`,
        `waitlist-position:${ranked[index].id}:${nextPosition}`,
      );
    }
  }
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function closeInquiryAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const enrollmentId = str(formData, "enrollment_id");
  const goodbye = formData.get("send_goodbye") === "on";
  const keep = formData.get("keep_on_file") === "on";
  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .update({
      stage: "withdrawn",
      stage_changed_at: new Date().toISOString(),
      closed_reason: str(formData, "reason") || "Closed by admin",
      closed_at: new Date().toISOString(),
      keep_on_file: keep,
      waitlist_status: "archived",
    })
    .eq("id", enrollmentId)
    .select("guardian_email, guardian_name")
    .single();
  if (error) return { error: error.message };
  if (goodbye) {
    await enqueueEnrollmentEmail(
      supabase,
      profile.daycare_id,
      enrollment.guardian_email,
      "inquiry_closed",
      "Thank you for considering Sunny Grove",
      `${enrollment.guardian_name ?? "Hello"}, thank you for getting to know us. Our door is always open if your plans change.`,
      `inquiry-closed:${enrollmentId}`,
    );
  }
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function sendWaitlistCheckinAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const ids = formData.getAll("enrollment_id").map(String);
  if (ids.length === 0) return { error: "Select at least one family." };
  const { data: families, error: readError } = await supabase
    .from("enrollments")
    .select("id, guardian_email, guardian_name, waitlist_unanswered_checkins, offer_code")
    .in("id", ids);
  if (readError) return { error: readError.message };
  for (const family of families ?? []) {
    const unanswered = family.waitlist_unanswered_checkins + 1;
    await supabase.from("enrollments").update({
      waitlist_last_contact_at: new Date().toISOString(),
      waitlist_unanswered_checkins: unanswered,
      waitlist_response_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }).eq("id", family.id);
    await enqueueEnrollmentEmail(
      supabase,
      profile.daycare_id,
      family.guardian_email,
      "waitlist_checkin",
      "Still interested in Sunny Grove?",
      `${str(formData, "message") || `${family.guardian_name ?? "Hello"}, you're still on our waitlist. Please confirm that you'd like to keep your spot.`} Respond securely in DailyLog: dailylog://inquiry?code=${encodeURIComponent(family.offer_code ?? "")}`,
      `waitlist-checkin:${family.id}:${unanswered}`,
    );
  }
  revalidatePath("/enrollment");
  return { ok: true };
}

export async function scheduleChildWithdrawalAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return { error: "No center on your profile." };
  const childId = str(formData, "child_id");
  const lastDay = str(formData, "last_day");
  const reason = str(formData, "reason");
  if (!childId || !lastDay || !reason) return { error: "Child, last day and reason are required." };
  const { data: existing } = await supabase
    .from("child_departures")
    .select("id")
    .eq("child_id", childId)
    .eq("status", "scheduled")
    .maybeSingle();
  const values = {
    last_day: lastDay,
    reason,
    notes: str(formData, "notes") || null,
    offer_spot_automatically: formData.get("auto_offer_spot") === "on",
  };
  const result = existing
    ? await supabase.from("child_departures").update(values).eq("id", existing.id)
    : await supabase.from("child_departures").insert({
        daycare_id: profile.daycare_id,
        child_id: childId,
        ...values,
      });
  if (result.error) return { error: result.error.message };
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
  const { error } = await supabase
    .from("children")
    .update({ archived_at: null, classroom_id: classroomId, enrolled_on: new Date().toISOString().slice(0, 10) })
    .eq("id", childId);
  if (error) return { error: error.message };
  await supabase.from("child_departures").update({ status: "cancelled" }).eq("child_id", childId).eq("status", "scheduled");
  await supabase.from("enrollments").update({ stage: "enrolled", stage_changed_at: new Date().toISOString() }).eq("child_id", childId);
  revalidatePath("/enrollment");
  revalidatePath("/children");
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

function jsonObject(value: unknown): { [key: string]: Json | undefined } {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as { [key: string]: Json | undefined }) }
    : {};
}

function waitlistSort(
  a: { waitlist_priority: string; waitlist_joined_at: string | null; created_at: string | null },
  b: { waitlist_priority: string; waitlist_joined_at: string | null; created_at: string | null },
  rules: { siblings_first: boolean; staff_children_next: boolean } = {
    siblings_first: true,
    staff_children_next: true,
  },
): number {
  const weight: Record<string, number> = {
    sibling: rules.siblings_first ? 0 : 2,
    staff: rules.staff_children_next ? (rules.siblings_first ? 1 : 0) : 2,
    public: 2,
  };
  const tier = (weight[a.waitlist_priority] ?? 2) - (weight[b.waitlist_priority] ?? 2);
  if (tier !== 0) return tier;
  return new Date(a.waitlist_joined_at ?? a.created_at ?? 0).getTime() - new Date(b.waitlist_joined_at ?? b.created_at ?? 0).getTime();
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
