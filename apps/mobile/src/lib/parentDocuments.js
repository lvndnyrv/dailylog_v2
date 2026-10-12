function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dateLabel(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function rows(values) {
  return values
    .filter(([, value]) => value != null && value !== '' && (!Array.isArray(value) || value.length))
    .map(([label, value]) => {
      const display = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value;
      return `<tr><th>${esc(label)}</th><td>${esc(display)}</td></tr>`;
    })
    .join('');
}

function enrollmentAgreement(record, child, daycare, profile) {
  const data = record.structured_data || {};
  return `
    <h1>Enrollment agreement</h1>
    <p class="lead">${esc(daycare?.name || 'Childcare center')} · ${esc(child?.first_name || '')} ${esc(child?.last_name || '')}</p>
    <section>
      <h2>Agreement record</h2>
      <p>This record confirms the family's electronic acceptance of the center's enrollment, tuition, attendance, health, pickup, and withdrawal policies.</p>
      <table>${rows([
        ['Child', `${child?.first_name || ''} ${child?.last_name || ''}`.trim()],
        ['Signed by', data.signature_name || profile?.full_name],
        ['Signed on', dateLabel(record.recorded_at)],
        ['Agreement version', record.version],
        ['Reference', record.reference],
        ['Tuition terms accepted', data.acknowledge_tuition ? 'Yes' : 'No'],
        ['Center policies accepted', data.acknowledge_policies ? 'Yes' : 'No'],
        ['Photo consent at signing', data.photo_consent ? 'Allowed' : 'Not allowed'],
      ])}</table>
    </section>`;
}

function applicationSummary(record, child, daycare) {
  const data = record.structured_data || {};
  return `
    <h1>Enrollment application summary</h1>
    <p class="lead">Submitted to ${esc(daycare?.name || 'the childcare center')} on ${esc(dateLabel(record.recorded_at))}</p>
    <section>
      <h2>Child and family</h2>
      <table>${rows([
        ['Child', data.child_full_name || `${child?.first_name || ''} ${child?.last_name || ''}`.trim()],
        ['Date of birth', data.child_date_of_birth || child?.date_of_birth],
        ['Allergies', data.allergies],
        ['Primary guardian', data.primary_guardian_name],
        ['Guardian email', data.primary_guardian_email],
        ['Guardian phone', data.primary_guardian_phone],
        ['Co-guardian', data.co_guardian_name],
        ['Co-guardian email', data.co_guardian_email],
        ['Emergency contact', data.emergency_contact_name],
        ['Emergency phone', data.emergency_contact_phone],
        ['Reference', record.reference],
      ])}</table>
    </section>`;
}

function healthSummary(record, child, daycare) {
  const data = record.structured_data || {};
  const contacts = Array.isArray(data.emergency_contacts)
    ? data.emergency_contacts.map((contact) => [contact.name, contact.relationship, contact.phone].filter(Boolean).join(' · '))
    : [];
  return `
    <h1>Allergy &amp; medical summary</h1>
    <p class="lead">Current family record for ${esc(child?.first_name || '')} ${esc(child?.last_name || '')} at ${esc(daycare?.name || 'the childcare center')}</p>
    <section>
      <h2>Health information</h2>
      <table>${rows([
        ['Allergies', data.allergies],
        ['Medical notes', data.medical_notes || 'None recorded'],
        ['Emergency contacts', contacts],
        ['Record updated', dateLabel(record.recorded_at)],
        ['Reference', record.reference],
      ])}</table>
    </section>`;
}

export function parentDocumentHtml({ record, child, daycare, profile }) {
  let body = healthSummary(record, child, daycare);
  if (record?.source_type === 'agreement') body = enrollmentAgreement(record, child, daycare, profile);
  if (record?.source_type === 'application_summary') body = applicationSummary(record, child, daycare);

  return `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    @page { margin: 42px; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #17335B; padding: 12px; }
    h1 { font-size: 25px; margin: 0 0 6px; }
    .lead { color: #5B6B82; font-size: 13px; margin: 0 0 28px; }
    section { border: 1px solid #D6E1F0; border-radius: 14px; padding: 20px; }
    h2 { font-size: 16px; margin: 0 0 10px; }
    p { color: #41546F; font-size: 13px; line-height: 1.55; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { padding: 10px 4px; border-bottom: 1px solid #EDF3FB; font-size: 12px; vertical-align: top; }
    th { color: #5B6B82; text-align: left; font-weight: 500; width: 38%; }
    td { color: #17335B; text-align: right; font-weight: 700; }
    footer { color: #8FA6C4; font-size: 10px; margin-top: 24px; text-align: center; }
  </style></head><body>
    ${body}
    <footer>Generated from the family-scoped DailyLog record · ${esc(new Date().toLocaleString('en-CA'))}</footer>
  </body></html>`;
}
