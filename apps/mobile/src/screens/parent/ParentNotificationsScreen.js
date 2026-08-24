import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { isToday, isYesterday } from 'date-fns';

import { useParentNotifications } from '../../hooks/useParentNotifications';
import { resolveNotificationRoute } from '../../lib/notificationRoutes';
import { colors, fonts, radius, spacing } from '../../theme';
import { ParentAccountHeader } from './ParentAccountShared';

const PRESENTATION = {
  incident: { icon: 'medkit-outline', tone: 'danger' },
  incident_report: { icon: 'medkit-outline', tone: 'danger' },
  medication: { icon: 'medical-outline', tone: 'purple' },
  parent_schedule: { icon: 'calendar-outline', tone: 'amber' },
  parent_document_request: { icon: 'document-text-outline', tone: 'amber' },
  parent_document_status: { icon: 'document-text-outline', tone: 'blue' },
  parent_document_record: { icon: 'document-attach-outline', tone: 'blue' },
  parent_messages: { icon: 'chatbubble-ellipses-outline', tone: 'blue' },
  message: { icon: 'chatbubble-ellipses-outline', tone: 'blue' },
  announcement: { icon: 'megaphone-outline', tone: 'blue' },
  daily_log: { icon: 'today-outline', tone: 'green' },
  parent_billing: { icon: 'card-outline', tone: 'amber' },
  parent_payment_receipt: { icon: 'receipt-outline', tone: 'green' },
  parent_data_request: { icon: 'shield-checkmark-outline', tone: 'blue' },
  overdue_billing: { icon: 'card-outline', tone: 'danger' },
  center_closure: { icon: 'calendar-outline', tone: 'amber' },
  center_closure_reminder: { icon: 'calendar-outline', tone: 'amber' },
  closure_cancelled: { icon: 'calendar-clear-outline', tone: 'blue' },
  room_move: { icon: 'swap-horizontal-outline', tone: 'blue' },
  room_move_cancelled: { icon: 'close-circle-outline', tone: 'amber' },
};

const TONES = {
  blue: { color: colors.primary, background: colors.primaryLight },
  green: { color: colors.success, background: colors.successLight },
  amber: { color: colors.amber, background: colors.amberLight },
  danger: { color: colors.danger, background: colors.dangerLight },
  purple: { color: colors.purple, background: colors.purpleLight },
};

function relativeTime(value) {
  if (!value) return 'now';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function groupKey(value) {
  const date = new Date(value || Date.now());
  if (isToday(date)) return 'TODAY';
  if (isYesterday(date)) return 'YESTERDAY';
  return 'EARLIER';
}

function NotificationRow({ notification, onPress, actionable }) {
  const presentationKey = notification.payload?.type || notification.kind;
  const meta = PRESENTATION[presentationKey] || PRESENTATION[notification.kind]
    || { icon: 'notifications-outline', tone: 'blue' };
  const tone = TONES[meta.tone] || TONES.blue;
  return (
    <TouchableOpacity
      style={[styles.row, !notification.read_at && styles.rowUnread]}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${notification.read_at ? '' : 'Unread. '}${notification.title}`}
    >
      {!notification.read_at ? <View style={styles.unreadRail} /> : null}
      <View style={[styles.icon, { backgroundColor: tone.background }]}>
        <Ionicons name={meta.icon} size={20} color={tone.color} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.rowTitle, !notification.read_at && styles.rowTitleUnread]}>
          {notification.title}
        </Text>
        {notification.body ? <Text style={styles.body} numberOfLines={2}>{notification.body}</Text> : null}
        <Text style={styles.time}>{relativeTime(notification.created_at)}</Text>
      </View>
      {actionable ? <Ionicons name="chevron-forward" size={17} color={colors.textFaint} /> : null}
    </TouchableOpacity>
  );
}

export default function ParentNotificationsScreen({ navigation }) {
  const center = useParentNotifications();
  const [actionError, setActionError] = useState('');

  useFocusEffect(useCallback(() => {
    center.refresh({ silent: true }).catch(() => {});
  }, [center.refresh]));

  const groups = useMemo(() => {
    const result = { TODAY: [], YESTERDAY: [], EARLIER: [] };
    center.notifications.forEach((notification) => {
      result[groupKey(notification.created_at)].push(notification);
    });
    return Object.entries(result).filter(([, rows]) => rows.length);
  }, [center.notifications]);

  async function markAll() {
    setActionError('');
    try {
      await center.markAllRead();
    } catch (error) {
      setActionError(error.message || 'Notifications could not be marked as read.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ParentAccountHeader navigation={navigation} title="Notifications" subtitle={center.unreadCount ? `${center.unreadCount} unread` : 'You are all caught up'} />
      <View style={styles.toolbar}>
        <Text style={styles.toolbarCopy}>Updates from your center and educators</Text>
        {center.unreadCount ? (
          <TouchableOpacity onPress={markAll} accessibilityRole="button">
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {(actionError || center.error) ? (
        <TouchableOpacity style={styles.errorCard} onPress={() => center.refresh().catch(() => {})}>
          <Text style={styles.errorText}>{actionError || center.error} Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}

      {center.loading && !center.notifications.length ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !center.notifications.length ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="notifications-outline" size={30} color={colors.primary} /></View>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyText}>Daily updates, messages, documents and schedule changes will appear here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={(
            <RefreshControl
              refreshing={center.refreshing}
              onRefresh={() => center.refresh({ silent: true }).catch(() => {})}
              tintColor={colors.primary}
            />
          )}
        >
          {groups.map(([label, notifications]) => (
            <View key={label} style={styles.group}>
              <Text style={styles.groupLabel}>{label}</Text>
              <View style={styles.card}>
                {notifications.map((notification, index) => {
                  const payload = { type: notification.kind, ...(notification.payload || {}) };
                  return (
                    <View key={notification.id}>
                      {index ? <View style={styles.divider} /> : null}
                      <NotificationRow
                        notification={notification}
                        actionable={Boolean(resolveNotificationRoute(payload, 'parent'))}
                        onPress={() => center.open(notification)}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingHorizontal: 22, paddingBottom: spacing.sm,
  },
  toolbarCopy: { flex: 1, color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5 },
  markAll: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  content: { paddingHorizontal: 22, paddingBottom: 42 },
  group: { marginBottom: spacing.lg },
  groupLabel: {
    marginBottom: spacing.sm, paddingHorizontal: 2, color: colors.textFaint,
    fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.8,
  },
  card: {
    overflow: 'hidden', borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, backgroundColor: colors.surface,
  },
  row: {
    minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  rowUnread: { backgroundColor: '#FBFDFF' },
  unreadRail: {
    position: 'absolute', left: 0, top: 12, bottom: 12, width: 3,
    borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: colors.primary,
  },
  icon: {
    width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13.5 },
  rowTitleUnread: { color: colors.textPrimary, fontFamily: fonts.bold },
  body: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  time: { marginTop: 5, color: colors.textFaint, fontFamily: fonts.regular, fontSize: 10.5 },
  divider: { height: 1, marginLeft: 72, backgroundColor: colors.borderSoft },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight, marginBottom: spacing.lg,
  },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18 },
  emptyText: {
    maxWidth: 290, marginTop: spacing.sm, color: colors.textMuted,
    fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center',
  },
  errorCard: {
    marginHorizontal: 22, marginBottom: spacing.md, borderWidth: 1,
    borderColor: `${colors.danger}44`, borderRadius: radius.md,
    backgroundColor: colors.dangerLight, padding: spacing.md,
  },
  errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12, lineHeight: 18 },
});
