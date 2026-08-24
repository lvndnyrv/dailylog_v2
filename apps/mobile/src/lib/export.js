import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { format } from 'date-fns';

/**
 * Export helpers — PDF via expo-print, CSV via expo-file-system + expo-sharing.
 */

async function sharePdf(html, dialogTitle) {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' });
  }
  return uri;
}

async function shareCsv(csv, filename, dialogTitle) {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle, UTI: 'public.comma-separated-values-text' });
  }
  return fileUri;
}

function escapeCalendarText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function calendarDate(value) {
  return String(value || '').replace(/-/g, '');
}

// Share a standards-based all-day calendar event. This works in Expo Go and
// production builds without requesting broad access to the user's calendars.
export async function exportTimeOffCalendar(request) {
  const nextDay = new Date(`${request.endsOn}T12:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const endExclusive = format(nextDay, 'yyyyMMdd');
  const label = {
    vacation: 'Vacation', sick: 'Sick leave', personal: 'Personal day',
    unpaid: 'Unpaid leave', other: 'Time off',
  }[request.kind] || 'Time off';
  const description = request.decisionNotes
    ? `Approved in DailyLog. Director note: ${request.decisionNotes}`
    : 'Approved time off in DailyLog.';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DailyLog//Time Off//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:time-off-${request.id}@dailylog.app`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${calendarDate(request.startsOn)}`,
    `DTEND;VALUE=DATE:${endExclusive}`,
    `SUMMARY:${escapeCalendarText(`DailyLog · ${label}`)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const fileUri = `${FileSystem.cacheDirectory}dailylog-time-off-${request.id}.ics`;
  await FileSystem.writeAsStringAsync(fileUri, ics, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/calendar',
      dialogTitle: 'Add approved time off to calendar',
      UTI: 'public.calendar-event',
    });
  }
  return fileUri;
}

const baseStyles = `
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #1A1A18; }
    h1 { font-size: 22px; color: #0F6E56; margin-bottom: 4px; }
    h2 { font-size: 15px; color: #6B6A64; font-weight: 500; margin-top: 0; }
    .section { margin-top: 20px; }
    .section-title { font-size: 15px; font-weight: 700; border-bottom: 2px solid #1D9E75; padding-bottom: 4px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { text-align: left; font-size: 12px; color: #6B6A64; padding: 6px 8px; border-bottom: 1px solid #E2E0D8; }
    td { font-size: 13px; padding: 6px 8px; border-bottom: 1px solid #F0EFE9; }
    .chip { display: inline-block; background: #E1F5EE; color: #0F6E56; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin: 2px; }
    .warn { background: #FCEBEB; color: #E24B4A; }
    .muted { color: #9B9A94; font-size: 12px; }
    .footer { margin-top: 32px; font-size: 11px; color: #9B9A94; border-top: 1px solid #E2E0D8; padding-top: 8px; }
  </style>
`;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── DAILY LOG → PDF ─────────────────────────────────────────────────────────
export async function exportDailyLogPdf({ child, log, meals, diapers, sleeps, activities, supplies, dateStr, daycareName }) {
  const mealRows = meals.map(m =>
    `<tr><td>${esc(m.time?.substring(0, 5))}</td><td>${esc(m.food_type || '—')}</td><td>${esc(m.amount)}</td></tr>`
  ).join('');

  const diaperRows = diapers.map(d =>
    `<tr><td>${esc(d.time?.substring(0, 5))}</td><td>${esc(d.type)}</td><td>${d.wet ? 'Wet' : ''} ${d.bm ? 'BM' : ''}</td></tr>`
  ).join('');

  const sleepRows = sleeps.map(s =>
    `<tr><td>${esc(s.start_time?.substring(0, 5))}</td><td>${esc(s.end_time?.substring(0, 5) || 'ongoing')}</td></tr>`
  ).join('');

  const html = `
    <html><head>${baseStyles}</head><body>
      <h1>${esc(child.first_name)} ${esc(child.last_name || '')} — Daily Log</h1>
      <h2>${esc(dateStr)}${daycareName ? ` · ${esc(daycareName)}` : ''}</h2>

      ${log?.moods?.length ? `<div class="section"><div class="section-title">Mood</div>${log.moods.map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}

      ${meals.length ? `<div class="section"><div class="section-title">Meals</div><table><tr><th>Time</th><th>Food</th><th>Amount</th></tr>${mealRows}</table></div>` : ''}

      ${sleeps.length ? `<div class="section"><div class="section-title">Sleep</div><table><tr><th>Start</th><th>End</th></tr>${sleepRows}</table></div>` : ''}

      ${diapers.length ? `<div class="section"><div class="section-title">Diaper / Toilet</div><table><tr><th>Time</th><th>Type</th><th>Details</th></tr>${diaperRows}</table></div>` : ''}

      ${activities.length ? `<div class="section"><div class="section-title">Activities</div>${activities.map(a => `<span class="chip">${esc(a.activity_name)}</span>`).join('')}</div>` : ''}

      ${supplies.length ? `<div class="section"><div class="section-title">Supplies needed</div>${supplies.map(s => `<span class="chip warn">${esc(s.item_name)}</span>`).join('')}</div>` : ''}

      ${log?.notes ? `<div class="section"><div class="section-title">Notes</div><p>${esc(log.notes)}</p></div>` : ''}
      ${log?.comments ? `<div class="section"><div class="section-title">Comments for parents</div><p>${esc(log.comments)}</p></div>` : ''}

      <div class="footer">Generated by DailyLog on ${format(new Date(), 'PPpp')}</div>
    </body></html>
  `;
  return sharePdf(html, `${child.first_name}'s daily log`);
}

// ─── INCIDENT REPORT → PDF ───────────────────────────────────────────────────
export async function exportIncidentPdf({ incident, child, daycareName }) {
  const sev = { minor: 'Minor', moderate: 'Moderate', serious: 'SERIOUS' }[incident.severity] || incident.severity;
  const html = `
    <html><head>${baseStyles}</head><body>
      <h1>Incident Report — ${esc(child.first_name)} ${esc(child.last_name || '')}</h1>
      <h2>${daycareName ? `${esc(daycareName)} · ` : ''}${esc(format(new Date(incident.occurred_at), 'PPpp'))}</h2>

      <div class="section">
        <table>
          <tr><th>Severity</th><td>${esc(sev)}</td></tr>
          <tr><th>Injury type</th><td>${esc(incident.injury_type)}</td></tr>
          <tr><th>Body parts</th><td>${esc((incident.body_parts || []).join(', ') || '—')}</td></tr>
          <tr><th>Location</th><td>${esc(incident.location || '—')}</td></tr>
          <tr><th>First aid given</th><td>${esc(incident.first_aid || '—')}</td></tr>
          <tr><th>Status</th><td>${esc(incident.status)}</td></tr>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Description</div>
        <p>${esc(incident.description || '—')}</p>
      </div>

      ${incident.parent_acknowledged_at ? `
        <div class="section">
          <div class="section-title">Parent acknowledgment</div>
          <p>Acknowledged by <strong>${esc(incident.parent_acknowledge_name)}</strong> on ${esc(format(new Date(incident.parent_acknowledged_at), 'PPpp'))}</p>
        </div>` : '<div class="section"><p class="muted">Not yet acknowledged by parent.</p></div>'}

      <div class="footer">Generated by DailyLog on ${format(new Date(), 'PPpp')} — retain per your licensing requirements.</div>
    </body></html>
  `;
  return sharePdf(html, 'Incident report');
}

// ─── ATTENDANCE → CSV ────────────────────────────────────────────────────────
export async function exportAttendanceCsv({ rows, classroomName, fromStr, toStr }) {
  const header = 'Date,Child,Checked in,Checked in by,Checked out,Checked out by\n';
  const body = rows.map(r => [
    r.date,
    `"${(r.child_name || '').replace(/"/g, '""')}"`,
    r.checked_in_at ? format(new Date(r.checked_in_at), 'HH:mm') : '',
    `"${(r.checked_in_by_name || '').replace(/"/g, '""')}"`,
    r.checked_out_at ? format(new Date(r.checked_out_at), 'HH:mm') : '',
    `"${(r.checked_out_by_name || '').replace(/"/g, '""')}"`,
  ].join(',')).join('\n');

  const filename = `attendance_${(classroomName || 'classroom').replace(/\W+/g, '_')}_${fromStr}_${toStr}.csv`;
  return shareCsv(header + body, filename, 'Attendance export');
}

// ─── PARENT BILLING STATEMENT / TAX RECEIPT → PDF ────────────────────────────
export async function exportBillingStatementPdf({
  kind,
  familyName,
  daycareName,
  billingEmail,
  statement,
}) {
  const isTax = kind === 'tax';
  const title = isTax
    ? `${statement?.year || ''} Childcare Tax Receipt`
    : `${format(new Date(`${statement?.period_start}T12:00:00`), 'MMMM yyyy')} Statement`;
  const period = isTax
    ? `January 1–December 31, ${statement?.year || ''}`
    : `${format(new Date(`${statement?.period_start}T12:00:00`), 'PPP')}–${format(new Date(`${statement?.period_end}T12:00:00`), 'PPP')}`;
  const total = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', minimumFractionDigits: 2,
  }).format((statement?.total_cents || 0) / 100);
  const html = `
    <html><head>${baseStyles}</head><body>
      <h1>${esc(title)}</h1>
      <h2>${esc(daycareName || 'DailyLog childcare center')}</h2>
      <div class="section">
        <table>
          <tr><th>Family</th><td>${esc(familyName || 'Family account')}</td></tr>
          <tr><th>Billing email</th><td>${esc(billingEmail || '—')}</td></tr>
          <tr><th>Period</th><td>${esc(period)}</td></tr>
          <tr><th>${isTax ? 'Eligible childcare payments' : 'Statement total'}</th><td><strong>${esc(total)}</strong></td></tr>
        </table>
      </div>
      <div class="section">
        <p class="muted">This family-scoped record was generated from DailyLog billing data. Keep it with your childcare records.</p>
      </div>
      <div class="footer">Generated by DailyLog on ${format(new Date(), 'PPpp')}</div>
    </body></html>
  `;
  return sharePdf(html, title);
}

// ─── PARENT PAYMENT RECEIPT → PDF ──────────────────────────────────────
export async function exportPaymentReceiptPdf({ receipt, daycareName, familyName }) {
  const method = receipt?.payment_method || {};
  const methodLabel = method.last4
    ? `${method.brand || method.method_type || 'Payment method'} ···· ${method.last4}`
    : method.brand || method.method_type || 'Payment method';
  const amount = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: receipt?.currency || 'CAD', minimumFractionDigits: 2,
  }).format((Number(receipt?.amount_cents) || 0) / 100);
  const paidAt = receipt?.paid_at
    ? format(new Date(receipt.paid_at), 'PPpp')
    : 'Not recorded';
  const refundedAt = receipt?.refunded_at
    ? format(new Date(receipt.refunded_at), 'PPpp')
    : null;
  const refunded = receipt?.status === 'refunded';
  const html = `
    <html><head>${baseStyles}</head><body>
      <h1>${refunded ? 'Refund receipt' : 'Payment receipt'}</h1>
      <h2>${esc(daycareName || 'DailyLog childcare center')}</h2>
      <div class="section">
        <table>
          ${familyName ? `<tr><th>Family</th><td>${esc(familyName)}</td></tr>` : ''}
          <tr><th>Invoice</th><td>${esc(receipt?.invoice_number || receipt?.invoice_label || '—')}</td></tr>
          <tr><th>Amount</th><td><strong>${esc(amount)}</strong></td></tr>
          <tr><th>Paid with</th><td>${esc(methodLabel)}</td></tr>
          <tr><th>Payment date</th><td>${esc(paidAt)}</td></tr>
          ${refundedAt ? `<tr><th>Refund date</th><td>${esc(refundedAt)}</td></tr>` : ''}
          ${receipt?.refund_reason ? `<tr><th>Refund note</th><td>${esc(receipt.refund_reason)}</td></tr>` : ''}
          <tr><th>Confirmation</th><td>${esc(receipt?.receipt_number || 'Recorded')}</td></tr>
          <tr><th>Status</th><td>${refunded ? 'Refunded' : 'Paid'}</td></tr>
        </table>
      </div>
      <div class="section">
        <p class="muted">This family-scoped receipt was generated from DailyLog billing data.</p>
      </div>
      <div class="footer">Generated by DailyLog on ${format(new Date(), 'PPpp')}</div>
    </body></html>
  `;
  return sharePdf(html, refunded ? 'Refund receipt' : 'Payment receipt');
}
