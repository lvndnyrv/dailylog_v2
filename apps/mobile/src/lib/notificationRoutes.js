import { isStaffRole } from '@dailylog/shared';
import { navigate } from './navigationRef';

function value(payload, ...keys) {
  for (const key of keys) {
    const candidate = payload?.[key];
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  }
  return null;
}

function parentHome(payload) {
  return {
    name: 'ParentTabs',
    params: {
      screen: 'ParentHome',
      params: {
        childId: value(payload, 'childId', 'child_id'),
        logDate: value(payload, 'logDate', 'log_date', 'date'),
      },
    },
  };
}

export function resolveNotificationRoute(payload = {}, role = 'parent') {
  const screen = String(payload.screen || '');
  const type = String(payload.type || payload.kind || '').toLowerCase();
  const childId = value(payload, 'childId', 'child_id');
  const incidentId = value(payload, 'incidentId', 'incident_id');
  const announcementId = value(payload, 'announcementId', 'announcement_id');
  const requestId = value(payload, 'requestId', 'request_id');
  const invoiceId = value(payload, 'invoiceId', 'invoice_id');
  const paymentId = value(payload, 'paymentId', 'payment_id');
  const closureId = value(payload, 'closureId', 'closure_id');
  const transitionId = value(payload, 'transitionId', 'transition_id');
  const authorizationId = value(payload, 'authorizationId', 'authorization_id');
  const medicationLogId = value(payload, 'medicationLogId', 'medication_log_id');

  if (role === 'parent') {
    if (screen === 'ParentNotifications') return { name: 'ParentNotifications' };
    if (screen === 'ParentPrivacyData' || type === 'parent_data_request') {
      return { name: 'ParentPrivacyData' };
    }
    if (screen === 'WeeklySummary' || type === 'weekly_summary') {
      return {
        name: 'ParentTabs',
        params: {
          screen: 'WeeklyTab',
          params: {
            childId,
            weekDate: value(payload, 'weekDate', 'week_date', 'week_start', 'date'),
            viewMode: value(payload, 'viewMode', 'view_mode', 'view', 'mode'),
          },
        },
      };
    }
    if ((screen === 'IncidentDetail' || type === 'incident') && incidentId) {
      return { name: 'IncidentDetail', params: { incidentId, childId } };
    }
    if (screen === 'ParentDocumentUpload' || type === 'parent_document_request') {
      return {
        name: 'ParentDocuments',
        params: { childId, focusRequestId: requestId },
      };
    }
    if (screen === 'ParentDocumentViewer' || type === 'parent_document_record') {
      return {
        name: 'ParentDocuments',
        params: {
          childId,
          focusRecordId: payload.recordId || payload.record_id,
          focusSourceType: payload.sourceType || payload.source_type,
        },
      };
    }
    if (screen === 'ParentDocuments' || type === 'parent_document_status') {
      return { name: 'ParentDocuments', params: { childId, focusRequestId: requestId } };
    }
    if ((screen === 'ParentInvoice' && invoiceId) || (type.includes('billing') && invoiceId)) {
      return { name: 'ParentInvoice', params: { invoiceId } };
    }
    if (screen === 'PaymentReceipt' && paymentId) {
      return { name: 'PaymentReceipt', params: { paymentId } };
    }
    if (screen === 'BillingHome' || type.includes('billing')) {
      return { name: 'BillingHome' };
    }
    if (screen === 'ParentClosureNotice' || ['center_closure', 'center_closure_reminder'].includes(type)) {
      return closureId ? { name: 'ParentClosureNotice', params: { closureId } } : { name: 'ParentClosures' };
    }
    if (screen === 'ParentClosures' || ['closure_cancelled', 'parent_schedule'].includes(type)) {
      return { name: 'ParentClosures' };
    }
    if (screen === 'ParentRoomMove' || type === 'room_move') {
      return { name: 'ParentRoomMove', params: { transitionId, childId } };
    }
    if (type === 'room_move_cancelled') return parentHome(payload);
    if (screen === 'Medication' || type === 'medication') {
      return {
        name: 'Medication',
        params: { childId, authorizationId, medicationLogId, linkedAt: Date.now() },
      };
    }
    if (screen === 'EventDetail' && announcementId) {
      return { name: 'EventDetail', params: { announcementId } };
    }
    if (screen === 'Announcements' || type === 'announcement') {
      return { name: 'Announcements' };
    }
    if (
      ['Messaging', 'Messages', 'ParentMessages'].includes(screen)
      || ['message', 'parent_messages'].includes(type)
    ) {
      return childId
        ? { name: 'Messaging', params: { childId, childName: payload.childName } }
        : { name: 'ParentTabs', params: { screen: 'MessagesTab' } };
    }
    if (
      screen === 'ParentTabs'
      || screen === 'ParentHome'
      || ['daily_log', 'parent_attendance', 'parent_moments', 'parent_routines'].includes(type)
      || childId
    ) {
      return parentHome(payload);
    }
    return null;
  }

  if (screen === 'RoomRatios' || type === 'ratio_alert') {
    return { name: 'RoomRatios', params: { roomId: value(payload, 'roomId', 'room_id') } };
  }
  if (screen === 'Attendance' || type === 'attendance_absence') {
    return { name: 'RollCall', params: { childId } };
  }
  if (screen === 'Pickups' || type === 'pickup_security') {
    return { name: 'Pickups', params: { childId, eventId: value(payload, 'eventId', 'event_id') } };
  }
  if (screen === 'IncidentHub' || ['incident', 'incident_acknowledged'].includes(type)) return { name: 'IncidentHub' };
  if (screen === 'EventDetail' && announcementId) {
    return isStaffRole(role)
      ? { name: 'EventRsvps', params: { announcementId } }
      : { name: 'EventDetail', params: { announcementId } };
  }
  if (screen === 'TimeOffDetail' && value(payload, 'requestId', 'request_id')) {
    return { name: 'TimeOffDetail', params: { requestId: value(payload, 'requestId', 'request_id') } };
  }
  if (screen === 'CredentialRenewal' || type === 'cert_expiry') {
    return { name: 'CredentialRenewal', params: { credentialId: value(payload, 'credentialId', 'credential_id') } };
  }
  if (screen === 'CredentialDetail' || type === 'credential_decision') {
    return { name: 'CredentialDetail', params: { credentialId: value(payload, 'credentialId', 'credential_id') } };
  }
  if (screen === 'Medication' || type === 'medication') {
    return {
      name: 'Medication',
      params: { childId, authorizationId, medicationLogId, linkedAt: Date.now() },
    };
  }
  if (screen === 'Announcements' || type === 'announcement') return { name: 'Announcements' };
  return null;
}

export function openNotificationRoute(payload, role) {
  const route = resolveNotificationRoute(payload, role);
  if (!route) return false;
  navigate(route.name, route.params);
  return true;
}
