import { supabase } from './supabase';

function parseLink(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return {
      parsed,
      // Expo Go prefixes app routes with /-- while standalone builds use the
      // custom-scheme host. Universal links may also live below a base path.
      isAuth: host === 'auth' || path.endsWith('/auth'),
      isInvite: host === 'invite' || path.endsWith('/invite'),
      isOffer: host === 'offer' || path.endsWith('/offer'),
      isInquiry: host === 'inquiry' || path.endsWith('/inquiry'),
      isReceipt: host === 'receipt' || path.endsWith('/receipt'),
      isMedication: host === 'medication' || path.endsWith('/medication'),
      isChildInvite: ['family-invite', 'child-invite'].includes(host)
        || path.endsWith('/family-invite')
        || path.endsWith('/child-invite'),
    };
  } catch {
    return null;
  }
}

export function extractParentChildInviteCode(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link?.isChildInvite) return null;
  return link.parsed.searchParams.get('code')
    || link.parsed.searchParams.get('invite_code');
}

export function extractMedicationLink(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link?.isMedication) return null;

  const childId = link.parsed.searchParams.get('child_id')
    || link.parsed.searchParams.get('child');
  if (!childId) return null;

  return {
    childId,
    compose: ['1', 'true', 'yes'].includes(
      String(link.parsed.searchParams.get('compose') || '').toLowerCase()
    ),
  };
}

/**
 * Converts whitelisted DailyLog business links into the same payload shape as
 * push notifications. Authentication, invite, offer and inquiry links remain
 * owned by their dedicated providers and are deliberately excluded here.
 */
export function extractNotificationDestination(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link) return null;

  const segments = link.parsed.pathname
    .toLowerCase()
    .split('/')
    .filter((segment) => segment && segment !== '--');
  const route = ['http:', 'https:', 'exp:', 'exps:'].includes(link.parsed.protocol)
    ? segments.at(-1)
    : (link.parsed.hostname || segments.at(-1));
  const param = (...keys) => {
    for (const key of keys) {
      const candidate = link.parsed.searchParams.get(key);
      if (candidate) return candidate;
    }
    return null;
  };
  const common = {
    childId: param('child_id', 'child'),
    notificationId: param('notification_id', 'notification'),
  };

  switch (route) {
    case 'today':
    case 'daily-log':
    case 'dailylog':
      return { ...common, type: 'daily_log', logDate: param('date', 'log_date') };
    case 'weekly':
    case 'weekly-summary':
      return {
        ...common,
        type: 'weekly_summary',
        screen: 'WeeklySummary',
        weekDate: param('week', 'week_start', 'date'),
        viewMode: param('view', 'mode'),
      };
    case 'incident':
      return { ...common, type: 'incident', screen: 'IncidentDetail', incidentId: param('incident_id', 'incident') };
    case 'chat':
    case 'message':
    case 'messages':
      return { ...common, type: 'parent_messages', screen: 'Messaging' };
    case 'document':
    case 'documents': {
      const recordId = param('record_id', 'record');
      if (recordId) {
        return {
          ...common,
          type: 'parent_document_record',
          screen: 'ParentDocumentViewer',
          recordId,
          sourceType: param('source_type', 'source'),
        };
      }
      return { ...common, type: 'parent_document_request', screen: 'ParentDocumentUpload', requestId: param('request_id', 'request') };
    }
    case 'invoice':
    case 'billing': {
      const invoiceId = param('invoice_id', 'invoice');
      return {
        ...common,
        type: 'parent_billing',
        screen: invoiceId ? 'ParentInvoice' : 'BillingHome',
        invoiceId,
      };
    }
    case 'receipt':
      return { ...common, screen: 'PaymentReceipt', paymentId: param('payment_id', 'payment') };
    case 'closure':
      return { ...common, type: 'center_closure', screen: 'ParentClosureNotice', closureId: param('closure_id', 'closure') };
    case 'room-move':
      return { ...common, type: 'room_move', screen: 'ParentRoomMove', transitionId: param('transition_id', 'transition') };
    case 'event':
      return { ...common, screen: 'EventDetail', announcementId: param('announcement_id', 'announcement') };
    case 'medication':
      return {
        ...common,
        type: 'medication',
        screen: 'Medication',
        authorizationId: param('authorization_id', 'authorization'),
        medicationLogId: param('medication_log_id', 'medication_log', 'dose'),
      };
    case 'notifications':
      return { ...common, screen: 'ParentNotifications' };
    case 'privacy':
    case 'privacy-data':
      return { ...common, type: 'parent_data_request', screen: 'ParentPrivacyData' };
    default:
      return null;
  }
}

export function extractPaymentReceiptId(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link?.isReceipt) return null;
  return link.parsed.searchParams.get('payment_id') || link.parsed.searchParams.get('payment');
}

export function extractEnrollmentJourney(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link?.isInquiry) return null;
  return {
    code: link.parsed.searchParams.get('code') || link.parsed.searchParams.get('journey_code'),
    centerId: link.parsed.searchParams.get('center') || link.parsed.searchParams.get('c'),
  };
}

export function extractEnrollmentOfferCode(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link?.isOffer) return null;
  return link.parsed.searchParams.get('code') || link.parsed.searchParams.get('offer_code');
}

/**
 * Staff invite links use `invite_code` when an auth callback also needs its own
 * `code` query parameter. Plain business links may use `code` for compatibility
 * with the web invite route.
 */
export function extractStaffInviteCode(url) {
  if (!url || typeof url !== 'string') return null;
  const link = parseLink(url);
  if (!link || (!link.isInvite && !link.isAuth)) return null;

  const explicitInviteCode = link.parsed.searchParams.get('invite_code');
  if (explicitInviteCode) return explicitInviteCode;

  // A plain /invite link uses `code` for the business invitation. On /auth,
  // `code` always belongs to Supabase PKCE and must never be treated as one.
  return link.isInvite ? link.parsed.searchParams.get('code') : null;
}

/**
 * Completes Supabase auth flows arriving via deep link
 * (magic-link parent invites, password recovery emails).
 *
 * Handles both flows:
 *  - PKCE:      dailylog://auth?code=...
 *  - Implicit:  dailylog://auth#access_token=...&refresh_token=...
 *
 * Returns true if a session was established.
 */
export async function handleAuthUrl(url) {
  if (!url || typeof url !== 'string') return false;

  try {
    const link = parseLink(url);
    if (!link) return false;

    // PKCE flow. On /invite, `code` is an auth code only when a separate
    // `invite_code` is present; otherwise it is the business invite code.
    const code = link.parsed.searchParams.get('code');
    const hasInviteCode = Boolean(link.parsed.searchParams.get('invite_code'));
    if (code && (link.isAuth || (link.isInvite && hasInviteCode))) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) console.warn('Auth code exchange failed:', error.message);
      return !error;
    }

    // Implicit flow: tokens in the URL fragment
    const fragment = url.split('#')[1];
    if (!fragment) return false;

    const params = {};
    for (const pair of fragment.split('&')) {
      const [key, value] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }

    if (params.error_description) {
      console.warn('Auth link error:', params.error_description);
      return false;
    }

    if (params.access_token && params.refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (error) console.warn('Auth setSession failed:', error.message);
      return !error;
    }
  } catch (err) {
    console.warn('Auth link handling error:', err.message);
  }
  return false;
}
