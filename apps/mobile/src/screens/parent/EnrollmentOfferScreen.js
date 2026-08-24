import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { Button, Chip, Input, PasswordStrength } from '../../components/ui';
import { BrandMark } from '../../components/AuthVisuals';
import { DatePickerField } from '../../components/DatePickerField';
import { useAuth } from '../../hooks/useAuth';
import { useEnrollmentOffer } from '../../hooks/useEnrollmentOffer';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const AGREEMENT_VERSION = '2026-08-21';
const OFFER_HERO = require('../../../assets/onboarding/child-day.jpg');

function money(cents, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency, minimumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function prettyDate(value) {
  if (!value) return 'To be confirmed';
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function deadline(value) {
  if (!value) return 'Offer deadline not set';
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return 'Offer expired';
  const hours = Math.ceil(ms / 3600000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} remaining`;
}

function safeFilePart(value) {
  return String(value || 'document')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-100);
}

function validPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function yearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function agreementHtml(offer) {
  const daycare = escapeHtml(offer.daycare_name || 'Childcare center');
  const child = escapeHtml([offer.child_first_name, offer.child_last_name].filter(Boolean).join(' '));
  const schedule = escapeHtml(offer.schedule?.label || 'Full-day care');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 42px; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color:#17335B; padding:12px; }
    h1 { font-size:27px; margin:0 0 6px; } h2 { font-size:17px; margin:24px 0 8px; }
    .lead { color:#5B6B82; font-size:13px; margin-bottom:26px; }
    .box { border:1px solid #D6E1F0; border-radius:14px; padding:20px; }
    p, li { color:#41546F; font-size:13px; line-height:1.6; }
    table { width:100%; border-collapse:collapse; } th, td { padding:10px 3px; border-bottom:1px solid #EDF3FB; font-size:12px; }
    th { color:#5B6B82; text-align:left; font-weight:500; } td { text-align:right; font-weight:700; }
    footer { margin-top:28px; color:#8FA6C4; text-align:center; font-size:10px; }
  </style></head><body>
    <h1>${daycare} enrollment agreement</h1>
    <p class="lead">Offer for ${child} · agreement version ${AGREEMENT_VERSION}</p>
    <div class="box"><table>
      <tr><th>Program</th><td>${escapeHtml(offer.classroom_name || 'Program')}</td></tr>
      <tr><th>Schedule</th><td>${schedule}</td></tr>
      <tr><th>Start date</th><td>${escapeHtml(prettyDate(offer.desired_start_date))}</td></tr>
      <tr><th>Monthly tuition</th><td>${escapeHtml(money(offer.tuition_cents, offer.currency))}</td></tr>
      <tr><th>Registration deposit</th><td>${escapeHtml(money(offer.deposit_cents, offer.currency))}</td></tr>
    </table></div>
    <h2>Tuition and withdrawal</h2><p>Tuition is billed monthly in advance. The registration deposit secures the offered place and is credited to the family account. Schedule changes and withdrawal are subject to the center's written-notice requirements.</p>
    <h2>Attendance, health, and medication</h2><p>Families agree to follow the center's attendance, illness exclusion, medication authorization, and emergency health procedures.</p>
    <h2>Pickup and safeguarding</h2><p>Only guardians and authorized pickups may collect the child. Identity verification may be required. Families must keep emergency and pickup information current.</p>
    <h2>DailyLog records and photos</h2><p>Operational records are shared privately with authorized family members. Photo consent is optional and can be changed later; declining photo consent does not affect enrollment.</p>
    <footer>Review this document before electronically signing in DailyLog. Contact ${daycare} if any term is unclear.</footer>
  </body></html>`;
}

function Header({ onBack, step }) {
  const progress = { application: 1, documents: 2, agreement: 3 }[step] || null;
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.headerButton} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={25} color={colors.textPrimary} />
      </TouchableOpacity>
      <BrandMark compact style={styles.brand} />
      {progress ? <Text style={styles.stepLabel}>Step {progress} of 3</Text> : <View style={styles.headerSpacer} />}
    </View>
  );
}

function Card({ children, style, tone }) {
  return <View style={[styles.card, tone === 'warm' && styles.cardWarm, tone === 'success' && styles.cardSuccess, style]}>{children}</View>;
}

function InfoRow({ label, value, last }) {
  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function CheckRow({ checked, onPress, label, optional, error }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.checkRow, error && styles.checkRowError]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkbox, error && styles.checkboxError, checked && styles.checkboxChecked]}>
        {checked ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
      </View>
      <View style={styles.checkContent}>
        <Text style={[styles.checkLabel, error && styles.checkLabelError]}>{label} {optional ? <Text style={styles.optional}>(optional)</Text> : null}</Text>
        {error ? <Text style={styles.checkErrorText}>{error}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function OfferLanding({ offer, busy, onReview, onDecline, onMessage }) {
  return (
    <View style={styles.centeredPage}>
      <Image source={OFFER_HERO} style={styles.offerHeroImage} resizeMode="cover" />
      <Text style={styles.eyebrow}>YOU'VE BEEN OFFERED A SPOT</Text>
      <Text style={styles.heroTitle}>A place for {offer.child_first_name} at {offer.daycare_name}</Text>
      <Text style={styles.heroText}>{offer.classroom_name || 'Your program'} · starts {prettyDate(offer.desired_start_date)}</Text>
      <Card style={styles.offerSummary}>
        <InfoRow label="Room" value={offer.classroom_name || 'Program'} />
        <InfoRow label="First day" value={prettyDate(offer.desired_start_date)} />
        <InfoRow label="Schedule" value={offer.schedule?.label || 'Mon–Fri · full day'} last />
      </Card>
      <View style={styles.deadlinePill}>
        <Ionicons name="time-outline" size={18} color={colors.amber} />
        <Text style={styles.deadlineText}>{deadline(offer.offer_expires_at)}</Text>
      </View>
      <Button label="Review & accept offer" onPress={onReview} loading={busy} style={styles.fullButton} />
      <Button label="Decline offer" onPress={onDecline} variant="ghost" style={styles.fullButton} />
      <TouchableOpacity onPress={onMessage} style={styles.textAction}>
        <Ionicons name="chatbubble-outline" size={17} color={colors.primary} />
        <Text style={styles.textActionLabel}>Message the center</Text>
      </TouchableOpacity>
    </View>
  );
}

function OfferDetails({ offer, busy, onAccept, onAgreementDocument }) {
  return (
    <View>
      <Text style={styles.eyebrow}>YOUR OFFER</Text>
      <Text style={styles.title}>Review the details</Text>
      <Text style={styles.subtitle}>Everything below comes directly from {offer.daycare_name}.</Text>
      <Card style={styles.childCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{offer.child_first_name?.slice(0, 1)}</Text></View>
        <View style={styles.flexOne}>
          <Text style={styles.cardTitle}>{offer.child_first_name} {offer.child_last_name}</Text>
          <Text style={styles.cardSub}>{offer.classroom_name} · starts {prettyDate(offer.desired_start_date)}</Text>
        </View>
      </Card>
      <Card>
        <InfoRow label="Schedule" value={offer.schedule?.label || 'Mon–Fri · full day'} />
        <InfoRow label="Monthly tuition" value={`${money(offer.tuition_cents, offer.currency)} / month`} />
        <InfoRow label="Deposit today" value={money(offer.deposit_cents, offer.currency)} last />
      </Card>
      <Card tone="success">
        <Text style={styles.cardTitle}>Included with enrollment</Text>
        {['Daily updates and photos', 'Family messaging', 'Attendance and pickup access'].map((item) => (
          <View key={item} style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={19} color={colors.success} />
            <Text style={styles.bulletText}>{item}</Text>
          </View>
        ))}
      </Card>
      <TouchableOpacity onPress={onAgreementDocument} style={styles.policyLink}>
        <Text style={styles.policyLinkText}>Read full offer & policies (PDF)</Text>
        <Ionicons name="chevron-forward" size={17} color={colors.primary} />
      </TouchableOpacity>
      <Button label="Accept offer" onPress={onAccept} loading={busy} style={styles.fullButton} />
    </View>
  );
}

function ApplicationStep({ offer, busy, onSubmit }) {
  const existing = offer.application_data || {};
  const [childName, setChildName] = useState(existing.child_full_name || [offer.child_first_name, offer.child_last_name].filter(Boolean).join(' '));
  const [dob, setDob] = useState(existing.child_date_of_birth || offer.child_date_of_birth || '');
  const [allergies, setAllergies] = useState((existing.allergies || []).join?.(', ') || '');
  const [guardianName, setGuardianName] = useState(existing.primary_guardian_name || offer.guardian_name || '');
  const [guardianPhone, setGuardianPhone] = useState(existing.primary_guardian_phone || offer.guardian_phone || '');
  const [coGuardianName, setCoGuardianName] = useState(existing.co_guardian_name || '');
  const [coGuardianEmail, setCoGuardianEmail] = useState(existing.co_guardian_email || '');
  const [showCoGuardian, setShowCoGuardian] = useState(Boolean(existing.co_guardian_name));
  const [emergencyName, setEmergencyName] = useState(existing.emergency_contact_name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(existing.emergency_contact_phone || '');
  const [errors, setErrors] = useState({});

  function changeField(key, setter) {
    return (value) => {
      setter(value);
      setErrors((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
  }

  function submit() {
    const nextErrors = {};
    if (!childName.trim()) nextErrors.childName = "Child's full name is required.";
    if (!dob.trim()) nextErrors.dob = 'Date of birth is required.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) nextErrors.dob = 'Use YYYY-MM-DD.';
    if (!guardianName.trim()) nextErrors.guardianName = 'Guardian full name is required.';
    if (!guardianPhone.trim()) nextErrors.guardianPhone = 'Guardian phone is required.';
    else if (!validPhone(guardianPhone)) nextErrors.guardianPhone = 'Enter a valid phone number.';
    if (showCoGuardian && (coGuardianName.trim() || coGuardianEmail.trim())) {
      if (!coGuardianName.trim()) nextErrors.coGuardianName = 'Enter the co-guardian name or remove this section.';
      if (!coGuardianEmail.trim()) nextErrors.coGuardianEmail = 'Enter the co-guardian email or remove this section.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coGuardianEmail.trim())) nextErrors.coGuardianEmail = 'Enter a valid email address.';
    }
    if (!emergencyName.trim()) nextErrors.emergencyName = 'Emergency contact name is required.';
    if (!emergencyPhone.trim()) nextErrors.emergencyPhone = 'Emergency contact phone is required.';
    else if (!validPhone(emergencyPhone)) nextErrors.emergencyPhone = 'Enter a valid phone number.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      return;
    }
    onSubmit({
      child_full_name: childName.trim(),
      child_date_of_birth: dob,
      allergies: allergies.split(',').map((item) => item.trim()).filter(Boolean),
      primary_guardian_name: guardianName.trim(),
      primary_guardian_email: offer.guardian_email,
      primary_guardian_phone: guardianPhone.trim(),
      co_guardian_name: coGuardianName.trim(),
      co_guardian_email: coGuardianEmail.trim().toLowerCase(),
      emergency_contact_name: emergencyName.trim(),
      emergency_contact_phone: emergencyPhone.trim(),
    });
  }

  return (
    <View>
      <Text style={styles.eyebrow}>APPLICATION · STEP 1 OF 3</Text>
      <Text style={styles.title}>Tell us about your family</Text>
      <Text style={styles.subtitle}>You can review these details with the center later.</Text>
      <Text style={styles.sectionHeading}>Child</Text>
      <Input label="Full name (required)" value={childName} onChangeText={changeField('childName', setChildName)} placeholder="Child's full name" error={errors.childName} />
      <DatePickerField
        label="Date of birth (required)"
        value={dob}
        onChange={changeField('dob', setDob)}
        minimumDate={yearsAgo(18)}
        maximumDate={new Date()}
        defaultDate={yearsAgo(3)}
        error={errors.dob}
      />
      <Input label="Allergies or dietary needs (optional)" value={allergies} onChangeText={setAllergies} placeholder="e.g. Peanuts, dairy" />
      <Text style={styles.sectionHeading}>Primary guardian</Text>
      <Input label="Full name (required)" value={guardianName} onChangeText={changeField('guardianName', setGuardianName)} error={errors.guardianName} />
      <Input label="Phone (required)" value={guardianPhone} onChangeText={changeField('guardianPhone', setGuardianPhone)} keyboardType="phone-pad" error={errors.guardianPhone} />
      {!showCoGuardian ? (
        <TouchableOpacity onPress={() => setShowCoGuardian(true)} style={styles.addRow}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.addRowText}>Add a co-guardian</Text>
        </TouchableOpacity>
      ) : (
        <Card style={styles.subCard}>
          <View style={styles.subCardHeader}>
            <Text style={styles.sectionHeadingInline}>Co-guardian</Text>
            <TouchableOpacity
              onPress={() => {
                setShowCoGuardian(false);
                setCoGuardianName('');
                setCoGuardianEmail('');
                setErrors((current) => {
                  const next = { ...current };
                  delete next.coGuardianName;
                  delete next.coGuardianEmail;
                  return next;
                });
              }}
              accessibilityRole="button"
            >
              <Text style={styles.removeLink}>Remove</Text>
            </TouchableOpacity>
          </View>
          <Input label="Full name" value={coGuardianName} onChangeText={changeField('coGuardianName', setCoGuardianName)} error={errors.coGuardianName} />
          <Input label="Email" value={coGuardianEmail} onChangeText={changeField('coGuardianEmail', setCoGuardianEmail)} keyboardType="email-address" autoCapitalize="none" error={errors.coGuardianEmail} />
          <Text style={styles.signatureHint}>After enrollment, we’ll prepare a secure family invitation for this email.</Text>
        </Card>
      )}
      <Text style={styles.sectionHeading}>Emergency contact</Text>
      <Input label="Full name (required)" value={emergencyName} onChangeText={changeField('emergencyName', setEmergencyName)} error={errors.emergencyName} />
      <Input label="Phone (required)" value={emergencyPhone} onChangeText={changeField('emergencyPhone', setEmergencyPhone)} keyboardType="phone-pad" error={errors.emergencyPhone} />
      {Object.keys(errors).length ? <Text style={styles.errorText}>Check the highlighted fields before continuing.</Text> : null}
      <Button label="Continue" onPress={submit} loading={busy} style={styles.fullButton} />
    </View>
  );
}

const DOCUMENT_TYPES = [
  { kind: 'immunization', title: 'Immunization record', required: true, icon: 'shield-checkmark-outline' },
  { kind: 'birth_certificate', title: 'Birth certificate', required: true, icon: 'document-text-outline' },
  { kind: 'custody', title: 'Custody document', required: false, icon: 'people-outline' },
];

function DocumentsStep({ offer, busy, uploadBusy, onUpload, onContinue }) {
  const documents = new Map((offer.documents || []).map((item) => [item.kind, item]));
  return (
    <View>
      <Text style={styles.eyebrow}>DOCUMENTS · STEP 2 OF 3</Text>
      <Text style={styles.title}>Add enrollment documents</Text>
      <Text style={styles.subtitle}>PDF, JPG or PNG · up to 10 MB each. You can finish missing documents later.</Text>
      {DOCUMENT_TYPES.map((item) => {
        const document = documents.get(item.kind);
        const isUploading = uploadBusy === item.kind;
        return (
          <Card key={item.kind} style={styles.documentCard}>
            <View style={styles.documentIcon}><Ionicons name={item.icon} size={23} color={colors.primary} /></View>
            <View style={styles.flexOne}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSub}>{item.required ? 'Required before the first day' : 'Optional · only if applicable'}</Text>
              {document ? (
                <Text
                  style={[
                    styles.fileName,
                    document.status === 'rejected' && styles.fileRejected,
                    document.status === 'verified' && styles.fileVerified,
                  ]}
                  numberOfLines={1}
                >
                  {document.status === 'verified' ? 'Verified · ' : document.status === 'rejected' ? 'Needs replacement · ' : 'Uploaded · '}
                  {document.file_name}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity disabled={isUploading} onPress={() => onUpload(item.kind)} style={styles.smallButton}>
              {isUploading ? <ActivityIndicator size="small" color={colors.primary} /> : (
                <Text style={styles.smallButtonText}>{document ? 'Replace' : 'Add'}</Text>
              )}
            </TouchableOpacity>
          </Card>
        );
      })}
      <Card tone="warm">
        <View style={styles.noticeRow}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.amber} />
          <Text style={styles.noticeText}>Files are private and visible only to authorized center administrators.</Text>
        </View>
      </Card>
      <Button label="Continue to agreement" onPress={onContinue} loading={busy} disabled={Boolean(uploadBusy)} style={styles.fullButton} />
    </View>
  );
}

function AgreementStep({ offer, busy, onSign, onAgreementDocument }) {
  const [tuition, setTuition] = useState(Boolean(offer.agreement_data?.acknowledge_tuition));
  const [policies, setPolicies] = useState(Boolean(offer.agreement_data?.acknowledge_policies));
  const [photo, setPhoto] = useState(Boolean(offer.agreement_data?.photo_consent));
  const [signature, setSignature] = useState(offer.agreement_data?.signature_name || offer.guardian_name || '');
  const [errors, setErrors] = useState({});

  function clearError(key) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function submit() {
    const nextErrors = {};
    if (!tuition) nextErrors.tuition = 'Required to continue.';
    if (!policies) nextErrors.policies = 'Required to continue.';
    if (!signature.trim()) nextErrors.signature = 'Legal signature is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSign({ signature: signature.trim(), tuition, policies, photo });
  }

  return (
    <View>
      <Text style={styles.eyebrow}>AGREEMENT · STEP 3 OF 3</Text>
      <Text style={styles.title}>Review and sign</Text>
      <Text style={styles.subtitle}>Enrollment agreement version {AGREEMENT_VERSION}.</Text>
      <Card>
        <View style={styles.agreementHeader}>
          <View style={styles.documentIcon}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
          <View style={styles.flexOne}>
            <Text style={styles.cardTitle}>{offer.daycare_name} enrollment agreement</Text>
            <Text style={styles.cardSub}>Tuition, withdrawal, attendance and health policies</Text>
          </View>
        </View>
        <View style={styles.previewBox}>
          <Text style={styles.previewText}>Your child’s place is reserved once the deposit is confirmed. Tuition is billed monthly. Families agree to the center’s illness, attendance, pickup and withdrawal policies.</Text>
        </View>
        <TouchableOpacity onPress={onAgreementDocument} style={styles.policyLink}>
          <Text style={styles.policyLinkText}>Read full agreement (PDF)</Text>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </TouchableOpacity>
      </Card>
      <CheckRow checked={tuition} onPress={() => { setTuition((value) => !value); clearError('tuition'); }} label="I accept the tuition and deposit terms." error={errors.tuition} />
      <CheckRow checked={policies} onPress={() => { setPolicies((value) => !value); clearError('policies'); }} label="I accept the attendance, health and withdrawal policies." error={errors.policies} />
      <CheckRow checked={photo} onPress={() => setPhoto((value) => !value)} label="I consent to photos in DailyLog updates." optional />
      <Input label="Legal signature (required)" value={signature} onChangeText={(value) => { setSignature(value); clearError('signature'); }} placeholder="Type your full legal name" error={errors.signature} />
      <Text style={styles.signatureHint}>Typing your name records an electronic signature with a timestamp and agreement version.</Text>
      {Object.keys(errors).length ? <Text style={styles.errorText}>Complete the highlighted agreement fields before continuing.</Text> : null}
      <Button label="Sign & continue" onPress={submit} loading={busy} style={styles.fullButton} />
    </View>
  );
}

function DepositStep({ offer, busy, includeFirstMonth, setIncludeFirstMonth, onPay, onMessage, onRefresh }) {
  const amount = (offer.deposit_cents || 0) + (includeFirstMonth ? (offer.tuition_cents || 0) : 0);
  const demo = offer.payment_mode === 'demo';
  return (
    <View>
      <Text style={styles.eyebrow}>FINAL STEP</Text>
      <Text style={styles.title}>Secure the spot</Text>
      <Text style={styles.subtitle}>Your signed agreement is saved. Confirm the deposit to finish enrollment.</Text>
      <Card style={styles.amountCard}>
        <Text style={styles.amountLabel}>Due now</Text>
        <Text style={styles.amount}>{money(amount, offer.currency)}</Text>
        <Text style={styles.amountSub}>Deposit credited toward your family account</Text>
      </Card>
      <Card>
        <View style={styles.paymentRow}>
          <View style={styles.paymentIcon}><Ionicons name={demo ? 'flask-outline' : 'card-outline'} size={24} color={colors.primary} /></View>
          <View style={styles.flexOne}>
            <Text style={styles.cardTitle}>{demo ? 'Test payment method' : 'Online payment'}</Text>
            <Text style={styles.cardSub}>{demo ? 'No real card will be charged' : 'Confirmed securely by the payment provider'}</Text>
          </View>
          <Ionicons name="lock-closed" size={17} color={colors.success} />
        </View>
      </Card>
      <Card style={styles.toggleCard}>
        <View style={styles.flexOne}>
          <Text style={styles.cardTitle}>Pay first month too</Text>
          <Text style={styles.cardSub}>Add {money(offer.tuition_cents, offer.currency)} to today’s payment</Text>
        </View>
        <Switch value={includeFirstMonth} onValueChange={setIncludeFirstMonth} trackColor={{ false: colors.border, true: colors.primaryLight }} thumbColor={includeFirstMonth ? colors.primary : colors.white} />
      </Card>
      {demo ? (
        <Button label={`Test pay & enroll · ${money(amount, offer.currency)}`} onPress={onPay} loading={busy} style={styles.fullButton} />
      ) : (
        <>
          <Card tone="warm"><Text style={styles.noticeText}>Your signed application is safe. Complete the deposit using the center’s payment instructions, then check the status here.</Text></Card>
          <Button label="Contact the center" onPress={onMessage} style={styles.fullButton} />
          <Button label="Check payment status" onPress={onRefresh} loading={busy} variant="ghost" style={styles.fullButton} />
        </>
      )}
      <Text style={styles.secureNote}>A real enrollment is finalized only after server-confirmed payment.</Text>
    </View>
  );
}

function OfferPoliciesSheet({ offer, onClose }) {
  const policies = [
    ['Tuition & deposit', `${money(offer.tuition_cents, offer.currency)} monthly. The ${money(offer.deposit_cents, offer.currency)} deposit is applied to the family account.`],
    ['Schedule', `${offer.schedule?.label || 'Full-day care'} beginning ${prettyDate(offer.desired_start_date)}.`],
    ['Attendance & illness', 'Families must follow the center’s attendance, health, medication, and exclusion guidance before bringing a child into care.'],
    ['Pickup', 'Only guardians and authorized pickups may collect the child. Identity verification may be required.'],
    ['Changes & withdrawal', 'Schedule, tuition, or withdrawal changes must be arranged with the center and may require written notice.'],
    ['Photos', 'Photo consent is optional and can be changed later from your family consent settings.'],
  ];
  return (
    <View style={styles.sheetOverlay}>
      <View style={[styles.sheet, styles.policySheet]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.title}>Offer & policy summary</Text>
        <Text style={styles.subtitle}>Review the terms attached to this enrollment before accepting or signing.</Text>
        <ScrollView style={styles.policySheetScroll} showsVerticalScrollIndicator={false}>
          {policies.map(([title, body]) => (
            <View key={title} style={styles.policySection}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardSub}>{body}</Text>
            </View>
          ))}
          <Card tone="warm" style={styles.policyNotice}>
            <Text style={styles.noticeText}>This in-app summary does not replace center-specific attachments or notices. Contact {offer.daycare_name} if any term is unclear before signing.</Text>
          </Card>
        </ScrollView>
        <Button label="Done reviewing" onPress={onClose} style={styles.fullButton} />
      </View>
    </View>
  );
}

function DeclinedStep({ offer, busy, onReopen, onMessage }) {
  return (
    <View style={styles.centeredPage}>
      <View style={[styles.celebration, styles.declinedIcon]}><Ionicons name="heart-outline" size={46} color={colors.purple} /></View>
      <Text style={styles.heroTitle}>Offer declined</Text>
      <Text style={styles.heroText}>We’ve let {offer.daycare_name} know. If you changed your mind before the deadline, you can reopen the offer.</Text>
      {offer.offer_decline_reason ? <Card><Text style={styles.cardSub}>Reason shared</Text><Text style={styles.cardTitle}>{offer.offer_decline_reason}</Text></Card> : null}
      <Button label="Reopen offer" onPress={onReopen} loading={busy} style={styles.fullButton} />
      <Button label="Message the center" onPress={onMessage} variant="ghost" style={styles.fullButton} />
    </View>
  );
}

function SuccessStep({ offer, busy, user, onLink, onCreate, onSignIn, onFinish, onUseAnotherAccount }) {
  const payment = offer.deposit_payment;
  const [mode, setMode] = useState(null);
  const [name, setName] = useState(offer.guardian_name || '');
  const [phone, setPhone] = useState(offer.guardian_phone || '');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const signedInEmail = user?.email?.toLowerCase();
  const offerEmail = offer.guardian_email?.toLowerCase();
  const wrongAccount = Boolean(user && signedInEmail !== offerEmail);

  async function shareCoGuardianInvite() {
    const invite = offer.co_guardian_invite;
    if (!invite) return;
    await Share.share({
      title: `DailyLog invitation for ${offer.child_first_name}`,
      message: `${invite.email}, you have been invited to join ${offer.child_first_name}'s DailyLog family. Open dailylog://family-invite?code=${encodeURIComponent(invite.code)} or enter code ${invite.code}.`,
    });
  }

  function clearError(key) {
    setServerError(null);
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function changeField(key, setter) {
    return (value) => {
      setter(value);
      clearError(key);
    };
  }

  async function submitCreate() {
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = 'Full name is required.';
    if (!phone.trim()) nextErrors.phone = 'Phone number is required.';
    if (!password) nextErrors.password = 'Password is required.';
    else if (password.length < 6) nextErrors.password = 'Use at least 6 characters.';
    if (!agreed) nextErrors.agreed = 'Required to create your family account.';
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length) return;
    await onCreate({ name: name.trim(), phone: phone.trim(), password, setError: setServerError });
  }

  async function submitSignIn() {
    if (!password) {
      setErrors({ password: 'Password is required.' });
      setServerError(null);
      return;
    }
    setErrors({});
    setServerError(null);
    await onSignIn({ password, setError: setServerError });
  }

  if (offer.account_linked) {
    return (
      <View style={styles.centeredPage}>
        <View style={[styles.celebration, styles.successIcon]}><Ionicons name="checkmark" size={52} color={colors.white} /></View>
        <Text style={styles.eyebrow}>ENROLLED</Text>
        <Text style={styles.heroTitle}>Welcome to {offer.daycare_name}!</Text>
        <Text style={styles.heroText}>{offer.child_first_name} is enrolled in {offer.classroom_name}. Your family account is ready.</Text>
        {offer.co_guardian_invite ? (
          <Card tone="success">
            <Text style={styles.cardTitle}>Co-guardian invitation ready</Text>
            <Text style={styles.cardSub}>Share the secure invitation with {offer.co_guardian_invite.email}. You can manage it later under Family & guardians.</Text>
            <Button label="Share invitation" onPress={shareCoGuardianInvite} variant="ghost" style={styles.fullButton} />
          </Card>
        ) : offer.application_data?.co_guardian_invite_created_at ? (
          <Card tone="success"><Text style={styles.cardSub}>The co-guardian invitation is ready under Family & guardians.</Text></Card>
        ) : null}
        <Button label="Open DailyLog" onPress={onFinish} style={styles.fullButton} />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.centeredTop}>
        <View style={[styles.celebration, styles.successIcon]}><Ionicons name="checkmark" size={52} color={colors.white} /></View>
        <Text style={styles.eyebrow}>ENROLLED</Text>
        <Text style={styles.heroTitle}>{offer.child_first_name} is enrolled!</Text>
        <Text style={styles.heroText}>The spot in {offer.classroom_name} is secured. Create or connect your family account to enter DailyLog.</Text>
      </View>
      {payment ? (
        <Card tone="success">
          <View style={styles.paymentRow}>
            <Ionicons name="receipt-outline" size={24} color={colors.success} />
            <View style={styles.flexOne}>
              <Text style={styles.cardTitle}>Deposit received · {money(payment.amount_cents, payment.currency)}</Text>
              <Text style={styles.cardSub}>
                {payment.email_status === 'delivered'
                  ? `Receipt emailed to ${payment.receipt_email}`
                  : ['pending', 'processing'].includes(payment.email_status)
                    ? `Receipt is on its way to ${payment.receipt_email}`
                    : `Receipt ${payment.receipt_number || 'saved'} is available with your enrollment`}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>What happens next</Text>
        {[
          'Create or connect your parent account.',
          `${offer.child_first_name} is linked to your family automatically.`,
          'Complete any outstanding documents before the first day.',
        ].map((item, index) => (
          <View key={item} style={styles.nextStepRow}>
            <View style={styles.nextStepNumber}><Text style={styles.nextStepNumberText}>{index + 1}</Text></View>
            <Text style={styles.nextStepText}>{item}</Text>
          </View>
        ))}
      </Card>
      {wrongAccount ? (
        <Card tone="warm">
          <Text style={styles.cardTitle}>Use the email on this offer</Text>
          <Text style={styles.cardSub}>You’re signed in as {user.email}. This enrollment was sent to {offer.guardian_email}, so it cannot be connected to the current account.</Text>
          <Button label="Use another account" onPress={onUseAnotherAccount} loading={busy} variant="ghost" style={styles.fullButton} />
        </Card>
      ) : user ? (
        <Button label="Connect this account" onPress={onLink} loading={busy} style={styles.fullButton} />
      ) : mode === null ? (
        <>
          <Button label="Create family account" onPress={() => setMode('create')} style={styles.fullButton} />
          <Button label="I already have an account" onPress={() => setMode('signin')} variant="ghost" style={styles.fullButton} />
        </>
      ) : (
        <Card>
          <Text style={styles.cardTitle}>{mode === 'create' ? 'Create your family account' : 'Sign in to connect enrollment'}</Text>
          <Text style={styles.readonlyEmail}>{offer.guardian_email}</Text>
          {mode === 'create' ? (
            <>
              <Input label="Full name (required)" value={name} onChangeText={changeField('name', setName)} error={errors.name} />
              <Input label="Phone (required)" value={phone} onChangeText={changeField('phone', setPhone)} keyboardType="phone-pad" error={errors.phone} />
            </>
          ) : null}
          <Input label="Password (required)" value={password} onChangeText={changeField('password', setPassword)} secureTextEntry placeholder={mode === 'create' ? 'Min. 6 characters' : 'Your password'} error={errors.password} />
          {mode === 'create' ? <PasswordStrength password={password} /> : null}
          {mode === 'create' ? <CheckRow checked={agreed} onPress={() => { setAgreed((value) => !value); clearError('agreed'); }} label="I agree to the Privacy Policy." error={errors.agreed} /> : null}
          {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}
          <Button label={mode === 'create' ? 'Create & connect account' : 'Sign in & connect'} onPress={mode === 'create' ? submitCreate : submitSignIn} loading={busy} />
          <TouchableOpacity onPress={() => { setMode(null); setPassword(''); setErrors({}); setServerError(null); }} style={styles.textAction}><Text style={styles.textActionLabel}>Back</Text></TouchableOpacity>
        </Card>
      )}
    </View>
  );
}

export default function EnrollmentOfferScreen() {
  const { code, revision, finishOffer } = useEnrollmentOffer();
  const { user, signUp, signIn, signOut, fetchProfile } = useAuth();
  const [offer, setOffer] = useState(null);
  const [step, setStep] = useState('offer');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(null);
  const [error, setError] = useState(null);
  const [includeFirstMonth, setIncludeFirstMonth] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [showPolicies, setShowPolicies] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollRef = useRef(null);

  const expired = offer?.offer_status === 'expired' || offer?.offer_status === 'withdrawn';
  const currentStep = offer?.offer_status === 'declined' ? 'declined' : step;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentStep]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: loadError } = await supabase.rpc('get_parent_enrollment_offer', { p_code: code });
      if (!active) return;
      if (loadError || !data) {
        setOffer(null);
        setError(loadError?.message || 'This offer could not be opened.');
      }
      else {
        setOffer(data);
        setStep(data.workflow_step === 'offer' && data.offer_status === 'viewed' ? 'offer' : data.workflow_step || 'offer');
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [code, reloadKey, revision]);

  async function runRpc(name, params, nextStep) {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(name, params);
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return null;
    }
    setOffer(data);
    if (nextStep) {
      setHistory((items) => [...items, step]);
      setStep(nextStep);
    } else if (data?.workflow_step) setStep(data.workflow_step);
    return data;
  }

  function goBack() {
    if (history.length) {
      setStep(history[history.length - 1]);
      setHistory((items) => items.slice(0, -1));
      return;
    }
    const previous = {
      details: 'offer',
      application: 'details',
      documents: 'application',
      agreement: 'documents',
      deposit: 'agreement',
    }[step];
    if (previous) setStep(previous);
    else if (step === 'offer' || step === 'declined' || step === 'enrolled') finishOffer();
  }

  async function messageCenter() {
    const phone = String(offer?.daycare_phone || '').replace(/[^+\d]/g, '');
    if (phone) {
      const body = encodeURIComponent(`Hello ${offer?.daycare_name || 'there'}, I have a question about the enrollment offer for ${offer?.child_first_name || 'my child'}.`);
      try {
        await Linking.openURL(`sms:${phone}&body=${body}`);
        return;
      } catch {
        // Fall through to a useful contact card when SMS is unavailable.
      }
    }
    Alert.alert(
      `Contact ${offer?.daycare_name || 'the center'}`,
      [offer?.daycare_phone, offer?.daycare_address].filter(Boolean).join('\n') || 'Contact details are not available on this offer.'
    );
  }

  async function uploadDocument(kind) {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;
    if ((asset.size || 0) > 10485760) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    setUploadBusy(kind);
    let uploadedPath = null;
    try {
      const mimeType = asset.mimeType || (asset.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const path = `enrollment-offers/${code}/${kind}/${Date.now()}-${safeFilePart(asset.name)}`;
      uploadedPath = path;
      const file = new File(asset.uri);
      const bytes = await file.arrayBuffer();
      const { error: uploadError } = await supabase.storage.from('documents').upload(path, bytes, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { data, error: saveError } = await supabase.rpc('save_parent_enrollment_document', {
        p_code: code,
        p_kind: kind,
        p_file_name: asset.name,
        p_mime_type: mimeType,
        p_file_size: asset.size || bytes.byteLength,
        p_storage_path: path,
      });
      if (saveError) throw saveError;
      if (data?.replaced_storage_path) {
        const { error: cleanupError } = await supabase.functions.invoke(
          'cleanup-parent-enrollment-upload',
          { body: { code, path: data.replaced_storage_path } }
        );
        if (cleanupError) {
          setError('The new document was saved, but the previous upload could not be cleaned up yet.');
        }
      }
      setOffer(data);
    } catch (uploadError) {
      if (uploadedPath) {
        await supabase.functions.invoke('cleanup-parent-enrollment-upload', {
          body: { code, path: uploadedPath },
        });
      }
      setError(uploadError.message || 'The document could not be uploaded.');
    } finally {
      setUploadBusy(null);
    }
  }

  async function openAgreementDocument() {
    try {
      await Print.printAsync({ html: agreementHtml(offer) });
    } catch (printError) {
      if (!/cancel/i.test(printError?.message || '')) {
        setError(printError?.message || 'The agreement PDF could not be opened.');
      }
    }
  }

  async function refreshOffer() {
    const data = await runRpc('get_parent_enrollment_offer', { p_code: code });
    if (data?.workflow_step) setStep(data.workflow_step);
  }

  async function linkAccount() {
    const linked = await runRpc('link_parent_enrollment_account', { p_code: code });
    if (linked && user) await fetchProfile(user.id);
  }

  async function createAccount({ name, phone, password, setError: setFormError }) {
    setBusy(true);
    const result = await signUp(offer.guardian_email, password, name, 'parent', phone);
    if (result.error) {
      setFormError(result.error.message);
      setBusy(false);
      return;
    }
    if (result.needsEmailConfirm) {
      setVerifyEmail(true);
      setBusy(false);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const activeUser = userData?.user;
    const { data, error: linkError } = await supabase.rpc('link_parent_enrollment_account', { p_code: code });
    if (linkError) setFormError(linkError.message);
    else {
      setOffer(data);
      if (activeUser) await fetchProfile(activeUser.id);
    }
    setBusy(false);
  }

  async function signInAccount({ password, setError: setFormError }) {
    setBusy(true);
    const result = await signIn(offer.guardian_email, password);
    if (result.error) {
      setFormError(result.error.message);
      setBusy(false);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const activeUser = userData?.user;
    const { data, error: linkError } = await supabase.rpc('link_parent_enrollment_account', { p_code: code });
    if (linkError) setFormError(linkError.message);
    else {
      setOffer(data);
      if (activeUser) await fetchProfile(activeUser.id);
    }
    setBusy(false);
  }

  const content = useMemo(() => {
    if (!offer) return null;
    if (currentStep === 'declined') return <DeclinedStep offer={offer} busy={busy} onReopen={() => runRpc('reopen_parent_enrollment_offer', { p_code: code })} onMessage={messageCenter} />;
    if (currentStep === 'offer') return <OfferLanding offer={offer} busy={busy} onReview={() => runRpc('review_parent_enrollment_offer', { p_code: code }, 'details')} onDecline={() => setShowDecline(true)} onMessage={messageCenter} />;
    if (currentStep === 'details') return <OfferDetails offer={offer} busy={busy} onAccept={() => runRpc('accept_parent_enrollment_offer', { p_code: code }, 'application')} onAgreementDocument={openAgreementDocument} />;
    if (currentStep === 'application') return <ApplicationStep offer={offer} busy={busy} onSubmit={(application) => runRpc('save_parent_enrollment_application', { p_code: code, p_application: application }, 'documents')} />;
    if (currentStep === 'documents') return <DocumentsStep offer={offer} busy={busy} uploadBusy={uploadBusy} onUpload={uploadDocument} onContinue={() => runRpc('continue_parent_enrollment_documents', { p_code: code }, 'agreement')} />;
    if (currentStep === 'agreement') return <AgreementStep offer={offer} busy={busy} onAgreementDocument={openAgreementDocument} onSign={(values) => runRpc('sign_parent_enrollment_agreement', { p_code: code, p_signature_name: values.signature, p_acknowledge_tuition: values.tuition, p_acknowledge_policies: values.policies, p_photo_consent: values.photo }, 'deposit')} />;
    if (currentStep === 'deposit') return <DepositStep offer={offer} busy={busy} includeFirstMonth={includeFirstMonth} setIncludeFirstMonth={setIncludeFirstMonth} onPay={() => runRpc('complete_demo_parent_enrollment_deposit', { p_code: code, p_include_first_month: includeFirstMonth })} onMessage={messageCenter} onRefresh={refreshOffer} />;
    return <SuccessStep offer={offer} busy={busy} user={user} onLink={linkAccount} onCreate={createAccount} onSignIn={signInAccount} onFinish={finishOffer} onUseAnotherAccount={signOut} />;
  }, [busy, code, currentStep, includeFirstMonth, offer, uploadBusy, user]);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Opening your secure offer…</Text></View>;
  if (verifyEmail) return (
    <View style={styles.loading}>
      <View style={styles.celebration}><Ionicons name="mail-outline" size={45} color={colors.primary} /></View>
      <Text style={styles.heroTitle}>Check your inbox</Text>
      <Text style={styles.heroText}>Confirm {offer?.guardian_email}, then reopen DailyLog. Your completed enrollment is saved.</Text>
    </View>
  );
  if (!offer || expired) return (
    <View style={styles.loading}>
      <View style={styles.celebration}><Ionicons name="time-outline" size={45} color={colors.amber} /></View>
      <Text style={styles.heroTitle}>{expired ? 'This offer is no longer open' : 'We could not open this offer'}</Text>
      <Text style={styles.heroText}>{error || 'Ask the center to send a new secure offer link.'}</Text>
      {offer ? <Button label="Contact the center" onPress={messageCenter} style={styles.fullButton} /> : <Button label="Try again" onPress={() => setReloadKey((value) => value + 1)} style={styles.fullButton} />}
      <Button label="Close" onPress={finishOffer} variant="ghost" style={styles.fullButton} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header onBack={goBack} step={currentStep} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {error ? <View style={styles.errorBanner}><Ionicons name="alert-circle" size={19} color={colors.danger} /><Text style={styles.errorBannerText}>{error}</Text></View> : null}
        {content}
      </ScrollView>
      {showDecline ? (
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.title}>Decline this offer?</Text>
            <Text style={styles.subtitle}>Sharing a reason is optional and helps the center plan.</Text>
            <View style={styles.chips}>
              {['Plans changed', 'Different center', 'Start date', 'Cost', 'Other'].map((reason) => (
                <Chip key={reason} label={reason} selected={declineReason === reason} onPress={() => setDeclineReason(reason)} />
              ))}
            </View>
            <Button label="Decline offer" variant="danger" loading={busy} onPress={async () => { const data = await runRpc('decline_parent_enrollment_offer', { p_code: code, p_reason: declineReason || null }); if (data) setShowDecline(false); }} />
            <Button label="Keep my offer" variant="ghost" onPress={() => setShowDecline(false)} style={styles.sheetButton} />
          </View>
        </View>
      ) : null}
      {showPolicies ? <OfferPoliciesSheet offer={offer} onClose={() => setShowPolicies(false)} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: 42, height: 42, alignItems: 'flex-start', justifyContent: 'center' },
  brand: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 42 },
  stepLabel: { width: 80, textAlign: 'right', color: colors.textMuted, fontSize: 12, fontFamily: fonts.bold },
  container: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: spacing.xl, paddingBottom: 48 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.bg },
  loadingText: { marginTop: spacing.md, color: colors.textMuted, fontFamily: fonts.regular },
  centeredPage: { alignItems: 'center', paddingTop: spacing.lg },
  centeredTop: { alignItems: 'center', marginBottom: spacing.xl },
  offerHeroImage: { width: '100%', height: 220, borderRadius: radius.xl, marginBottom: spacing.xl, backgroundColor: colors.primaryLight },
  celebration: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg, position: 'relative' },
  successIcon: { backgroundColor: colors.success },
  declinedIcon: { backgroundColor: colors.purpleLight },
  confettiOne: { position: 'absolute', width: 10, height: 20, borderRadius: 5, backgroundColor: '#F2B544', left: -3, top: 5, transform: [{ rotate: '-25deg' }] },
  confettiTwo: { position: 'absolute', width: 9, height: 18, borderRadius: 5, backgroundColor: '#8CC6A9', right: -5, bottom: 5, transform: [{ rotate: '30deg' }] },
  eyebrow: { fontSize: 12, letterSpacing: 1.6, fontFamily: fonts.black, color: colors.primary, marginBottom: spacing.sm },
  heroTitle: { fontSize: 29, lineHeight: 35, fontFamily: fonts.black, color: colors.textPrimary, textAlign: 'center' },
  heroText: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular, color: colors.textMuted, textAlign: 'center', maxWidth: 390, marginTop: spacing.sm, marginBottom: spacing.xl },
  title: { fontSize: 27, lineHeight: 34, fontFamily: fonts.black, color: colors.textPrimary },
  subtitle: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.xl },
  card: { width: '100%', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardWarm: { backgroundColor: colors.amberLight, borderColor: '#EED7AE' },
  cardSuccess: { backgroundColor: colors.successLight, borderColor: '#B9DFC9' },
  subCard: { backgroundColor: colors.primarySoft, marginTop: spacing.sm },
  subCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  removeLink: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13, marginBottom: spacing.md },
  offerSummary: { marginTop: spacing.lg },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontFamily: fonts.black, color: colors.primary },
  flexOne: { flex: 1, minWidth: 0 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14 },
  infoValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14, textAlign: 'right' },
  deadlinePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.full, backgroundColor: colors.amberLight, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginVertical: spacing.md },
  deadlineText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 13 },
  fullButton: { width: '100%', marginTop: spacing.md },
  textAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, marginTop: spacing.xs },
  textActionLabel: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  cardTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15 },
  cardSub: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  bulletText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14 },
  nextStepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  nextStepNumber: { width: 25, height: 25, flexShrink: 0, borderRadius: 13, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  nextStepNumberText: { color: colors.primary, fontFamily: fonts.black, fontSize: 12 },
  nextStepText: { flex: 1, minWidth: 0, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  policyLink: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  policyLinkText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  sectionHeading: { fontSize: 17, fontFamily: fonts.black, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.md },
  sectionHeadingInline: { fontSize: 16, fontFamily: fonts.black, color: colors.textPrimary, marginBottom: spacing.md },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, marginBottom: spacing.md },
  addRowText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13, lineHeight: 19, marginVertical: spacing.sm },
  documentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  documentIcon: { width: 43, height: 43, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  fileName: { color: colors.success, fontFamily: fonts.bold, fontSize: 12, marginTop: spacing.xs },
  fileVerified: { color: colors.success },
  fileRejected: { color: colors.danger },
  smallButton: { minWidth: 66, minHeight: 38, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  smallButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  noticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  agreementHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  previewBox: { marginTop: spacing.lg, backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md },
  previewText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderWidth: 1.5, borderColor: 'transparent', borderRadius: radius.md },
  checkRowError: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxError: { borderColor: colors.danger },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkContent: { flex: 1 },
  checkLabel: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  checkLabelError: { color: colors.danger },
  checkErrorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  optional: { color: colors.textFaint },
  signatureHint: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: -spacing.sm },
  amountCard: { alignItems: 'center', paddingVertical: spacing.xxl },
  amountLabel: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  amount: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 38, marginVertical: spacing.xs },
  amountSub: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  paymentIcon: { width: 48, height: 40, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  toggleCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  secureNote: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: spacing.md },
  readonlyEmail: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 14, backgroundColor: colors.bg, padding: spacing.md, borderRadius: radius.md, marginVertical: spacing.md },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  errorBannerText: { flex: 1, color: colors.danger, fontFamily: fonts.bold, fontSize: 13, lineHeight: 19 },
  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(23,51,91,0.42)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 36 },
  policySheet: { maxHeight: '88%' },
  policySheetScroll: { flexGrow: 0 },
  policySection: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  policyNotice: { marginTop: spacing.lg, marginBottom: 0 },
  sheetHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: spacing.xl },
  sheetButton: { marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg },
});
