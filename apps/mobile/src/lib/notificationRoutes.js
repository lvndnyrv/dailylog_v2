import { isAdminRole, isStaffRole } from '@dailylog/shared';
import { navigate } from './navigationRef';

function value(payload, ...keys) {
  for (const key of keys) {
    const candidate = payload?.[key];
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  }
  return null;
}

function idFromHref(payload, segment) {
  const href = String(payload?.href || '');
  const match = href.match(new RegExp(`/${segment}/([0-9a-f-]{36})(?:[/?#]|$)`, 'i'));
  return match?.[1] || null;
}

function staffProfileRoute(role, params = {}) {
  return isAdminRole(role)
    ? { name: 'AdminTabs', params: { screen: 'AdminSettings', params } }
    : { name: 'EducatorTabs', params: { screen: 'ProfileTab', params } };
}

function parentHome(payload) {
  return {
    name: 'ParentTabs',
    params: {
      screen: 'ParentHome',
      params: {
        childId: value(payload, 'childId', 'child_id'),
        logDate: value(payload, 'logDate', 'log_date', 'date'),
        linkedAt: Date.now(),
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
  const enrollmentId = value(payload, 'enrollmentId', 'enrollment_id') || idFromHref(payload, 'enrollment');
  const closureId = value(payload, 'closureId', 'closure_id');
  const transitionId = value(payload, 'transitionId', 'transition_id');
  const authorizationId = value(payload, 'authorizationId', 'authorization_id');
  const medicationLogId = value(payload, 'medicationLogId', 'medication_log_id');
  const composeMedication = payload.compose === true
    || ['1', 'true', 'yes'].includes(String(payload.compose || '').toLowerCase());

  if (role === 'parent') {
    if (screen === 'ParentNotifications') return { name: 'ParentNotifications' };
    if (screen === 'ParentEditProfile' || type === 'family_profile_updated') {
      return { name: 'ParentEditProfile', params: { linkedAt: Date.now() } };
    }
    if (screen === 'AuthorizedPickups' || type === 'pickup_reviewed') {
      return { name: 'AuthorizedPickups', params: { childId, linkedAt: Date.now() } };
    }
    if (screen === 'PickupPass' || type === 'parent_pickup') {
      return { name: 'PickupPass', params: { childId } };
    }
    if (screen === 'ReportAbsence' || type === 'parent_absence') {
      return { name: 'ReportAbsence', params: { childId, linkedAt: Date.now() } };
    }
    if (screen === 'ParentDayRecap' || type === 'daily_recap') {
      const logDate = value(payload, 'logDate', 'log_date', 'date');
      return childId && logDate
        ? { name: 'ParentDayRecap', params: { childId, childName: payload.childName, logDate } }
        : parentHome(payload);
    }
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
      return { name: 'IncidentDetail', params: { incidentId, childId, linkedAt: Date.now() } };
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
        params: {
          childId,
          authorizationId,
          medicationLogId,
          compose: composeMedication,
          linkedAt: Date.now(),
        },
      };
    }
    if (screen === 'EventDetail' && announcementId) {
      return { name: 'EventDetail', params: { announcementId } };
    }
    if (screen === 'Announcements' || type === 'announcement') {
      return {
        name: 'Announcements',
        params: { announcementId, linkedAt: Date.now() },
      };
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

  if (screen === 'RoomRatios' || ['ratio_alert', 'room_activity_nudge', 'coverage_review', 'room_lead_handoff', 'room_transition_review'].includes(type)) {
    return {
      name: 'RoomRatios',
      params: {
        roomId: value(payload, 'roomId', 'room_id'),
        nudgeId: value(payload, 'nudgeId', 'nudge_id'),
        assignmentId: value(payload, 'assignmentId', 'assignment_id'),
        transitionPlanId: value(payload, 'planId', 'plan_id'),
        leadHandoff: type === 'room_lead_handoff',
      },
    };
  }
  if (screen === 'ProfileTab' || ['permission_update', 'staff_role_changed'].includes(type)) {
    return staffProfileRoute(role, { linkedAt: Date.now() });
  }
  if (screen === 'Dashboard' && isAdminRole(role)) {
    return { name: 'AdminTabs', params: { screen: 'AdminDashboard' } };
  }
  if (screen === 'Credentials' || type === 'credential_reminder') {
    return { name: 'Credentials', params: { credentialId: value(payload, 'credentialId', 'credential_id') } };
  }
  if (isAdminRole(role) && (type === 'compliance_due' || String(payload.href || '').startsWith('/compliance'))) {
    return { name: 'AdminCompliance', params: { linkedAt: Date.now() } };
  }
  if (type === 'new_device_sign_in' || String(payload.href || '').includes('/settings#security')) {
    return staffProfileRoute(role, { focusSection: 'security', linkedAt: Date.now() });
  }
  if (
    isAdminRole(role)
    && (screen === 'Billing' || type.includes('billing') || type === 'payment_received' || String(payload.href || '').startsWith('/billing'))
  ) {
    return invoiceId
      ? { name: 'AdminInvoiceDetail', params: { invoiceId, paymentId, linkedAt: Date.now() } }
      : { name: 'AdminBilling', params: { paymentId, linkedAt: Date.now() } };
  }
  if (
    isAdminRole(role)
    && (['ParentEnrollmentOffer', 'EnrollmentOffer', 'ParentInquiryJourney', 'Enrollment'].includes(screen)
      || type === 'waitlist_enrollment'
      || String(payload.href || '').startsWith('/enrollment'))
  ) {
    return enrollmentId
      ? { name: 'AdminEnrollmentReview', params: { enrollmentId, linkedAt: Date.now() } }
      : { name: 'AdminEnrollmentReview' };
  }
  if (screen === 'StaffConversation' || type === 'staff_message') {
    return {
      name: 'StaffConversation',
      params: {
        conversationId: value(payload, 'conversationId', 'conversation_id'),
        otherProfileId: value(payload, 'otherProfileId', 'other_profile_id'),
      },
    };
  }
  if (
    ['Messaging', 'Messages', 'ParentMessages'].includes(screen)
    || ['message', 'parent_messages'].includes(type)
  ) {
    return childId
      ? {
          name: 'Messaging',
          params: {
            childId,
            childName: payload.childName,
            conversationId: value(payload, 'conversationId', 'conversation_id'),
          },
        }
      : null;
  }
  if (screen === 'Attendance' || ['attendance_absence', 'attendance_absence_cancelled'].includes(type)) {
    return {
      name: 'StaffAbsenceDetail',
      params: {
        childId,
        reportId: value(payload, 'reportId', 'report_id'),
        startsOn: value(payload, 'startsOn', 'starts_on', 'date'),
        endsOn: value(payload, 'endsOn', 'ends_on'),
        linkedAt: Date.now(),
      },
    };
  }
  if (type === 'parent_document_review') {
    return {
      name: 'AdminDocumentReview',
      params: {
        childId,
        requestId,
        submissionId: value(payload, 'submissionId', 'submission_id'),
        linkedAt: Date.now(),
      },
    };
  }
  if (screen === 'ChildProfile' || type === 'pickup_review') {
    return {
      name: 'ChildProfile',
      params: {
        childId,
        pickupId: value(payload, 'pickupId', 'pickup_id'),
        focusSection: type === 'pickup_review' ? 'pickups' : undefined,
        linkedAt: Date.now(),
      },
    };
  }
  if (screen === 'ChildConsents' || type === 'activity_consent') {
    return { name: 'ChildConsents', params: { childId, linkedAt: Date.now() } };
  }
  if (screen === 'Pickups' || ['pickup_security', 'pickup_security_resolved'].includes(type)) {
    return {
      name: 'Pickups',
      params: { childId, eventId: value(payload, 'eventId', 'event_id'), linkedAt: Date.now() },
    };
  }
  if (screen === 'IncidentHub' || ['incident', 'incident_report', 'incident_acknowledged'].includes(type)) {
    return incidentId
      ? { name: 'IncidentRecord', params: { incidentId, childId, linkedAt: Date.now() } }
      : { name: 'IncidentHub' };
  }
  if (screen === 'EventDetail' && announcementId) {
    return isStaffRole(role)
      ? { name: 'EventRsvps', params: { announcementId } }
      : { name: 'EventDetail', params: { announcementId } };
  }
  if (type === 'time_off_request' && isAdminRole(role) && requestId) {
    return {
      name: 'AdminTimeOff',
      params: { requestId, linkedAt: Date.now() },
    };
  }
  if (screen === 'TimeOffDetail' && value(payload, 'requestId', 'request_id')) {
    return { name: 'TimeOffDetail', params: { requestId: value(payload, 'requestId', 'request_id') } };
  }
  if (screen === 'MyTime' || type === 'schedule_update') {
    return { name: 'MyTime' };
  }
  if (screen === 'WeeklyTimesheet' || type === 'timesheet_review') {
    return {
      name: 'WeeklyTimesheet',
      params: {
        entryId: value(payload, 'entryId', 'entry_id'),
        clockedAt: value(payload, 'clockedAt', 'clocked_at'),
        linkedAt: Date.now(),
      },
    };
  }
  if (screen === 'StaffCredentialReview' || type === 'credential_review') {
    return {
      name: 'AdminCredentials',
      params: {
        submissionId: value(payload, 'submissionId', 'submission_id'),
        staffMemberId: value(payload, 'staffMemberId', 'staff_member_id'),
        linkedAt: Date.now(),
      },
    };
  }
  if (['parent_data_request_admin', 'account_deletion_request_admin'].includes(type) || screen === 'AdminPrivacyRequests') {
    return {
      name: 'AdminPrivacyRequests',
      params: {
        requestId: value(payload, 'requestId', 'request_id'),
        requestType: value(payload, 'requestType', 'request_type'),
        source: value(payload, 'source'),
      },
    };
  }
  if (type === 'account_deletion_request' || screen === 'Settings') {
    return staffProfileRoute(role, {
      requestId: value(payload, 'requestId', 'request_id'),
      linkedAt: Date.now(),
    });
  }
  if (screen === 'CredentialRenewal' || type === 'cert_expiry') {
    const credentialId = value(payload, 'credentialId', 'credential_id');
    return isAdminRole(role)
      ? {
          name: 'AdminCredentials',
          params: {
            credentialId,
            staffMemberId: value(payload, 'staffMemberId', 'staff_member_id'),
            linkedAt: Date.now(),
          },
        }
      : { name: credentialId ? 'CredentialRenewal' : 'Credentials', params: credentialId ? { credentialId } : undefined };
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
  if (screen === 'Announcements' || type === 'announcement') {
    return {
      name: 'Announcements',
      params: { announcementId, linkedAt: Date.now() },
    };
  }
  return null;
}

export function openNotificationRoute(payload, role) {
  const route = resolveNotificationRoute(payload, role);
  if (!route) return false;
  navigate(route.name, route.params);
  return true;
}
