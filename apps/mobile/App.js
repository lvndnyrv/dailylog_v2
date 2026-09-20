import React from 'react';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Lato_400Regular,
  Lato_700Bold,
  Lato_900Black,
} from '@expo-google-fonts/lato';
import Constants from 'expo-constants';
import { isAdminRole } from '@dailylog/shared';

import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { StaffInviteProvider, useStaffInvite } from './src/hooks/useStaffInvite';
import { EnrollmentOfferProvider, useEnrollmentOffer } from './src/hooks/useEnrollmentOffer';
import { EnrollmentJourneyProvider, useEnrollmentJourney } from './src/hooks/useEnrollmentJourney';
import { PaymentReceiptLinkProvider, usePaymentReceiptLink } from './src/hooks/usePaymentReceiptLink';
import { ParentChildInviteProvider, useParentChildInvite } from './src/hooks/useParentChildInvite';
import { ClassroomProvider } from './src/hooks/useClassroom';
import { ParentFamilyProvider, useParentFamily } from './src/hooks/useParentFamily';
import { ParentNotificationsProvider, useParentNotifications } from './src/hooks/useParentNotifications';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { useUnreadMessages } from './src/hooks/useUnreadMessages';
import { LoadingScreen, Button } from './src/components/ui';
import { OfflineBanner } from './src/components/OfflineBanner';
import { ToastHost } from './src/components/Toast';
import { PushPrimingModal } from './src/components/PushPriming';
import { ForceUpdateGate } from './src/components/ForceUpdateGate';
import { BiometricGate } from './src/components/BiometricGate';
import { RatioAlertGate } from './src/components/RatioAlertGate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WelcomeScreen, { WELCOME_SEEN_KEY } from './src/screens/shared/WelcomeScreen';
import { flushPendingNavigation, navigationRef } from './src/lib/navigationRef';
import { colors, fonts, spacing } from './src/theme';

import LoginScreen          from './src/screens/shared/LoginScreen';
import SignupScreen         from './src/screens/shared/SignupScreen';
import CenterSetupIntroScreen from './src/screens/shared/CenterSetupIntroScreen';
import ForgotPasswordScreen from './src/screens/shared/ForgotPasswordScreen';
import ResetPasswordScreen  from './src/screens/shared/ResetPasswordScreen';
import StaffInviteScreen    from './src/screens/shared/StaffInviteScreen';
import StaffTermsScreen     from './src/screens/shared/StaffTermsScreen';
import SettingsScreen       from './src/screens/shared/SettingsScreen';
import PrivacyScreen        from './src/screens/shared/PrivacyScreen';
import MessagingScreen      from './src/screens/shared/MessagingScreen';
import OnboardingScreen      from './src/screens/educator/OnboardingScreen';
import RosterScreen          from './src/screens/educator/RosterScreen';
import DailyLogScreen        from './src/screens/educator/DailyLogScreen';
import DailyReportReviewScreen from './src/screens/educator/DailyReportReviewScreen';
import ManageScreen          from './src/screens/educator/ManageScreen';
import EditProfileScreen     from './src/screens/educator/EditProfileScreen';
import BulkLogScreen         from './src/screens/educator/BulkLogScreen';
import ChildProfileScreen    from './src/screens/educator/ChildProfileScreen';
import IncidentReportScreen  from './src/screens/educator/IncidentReportScreen';
import IncidentHubScreen     from './src/screens/educator/IncidentHubScreen';
import IncidentRecordScreen  from './src/screens/educator/IncidentRecordScreen';
import MyTimeScreen          from './src/screens/educator/MyTimeScreen';
import WeeklyTimesheetScreen from './src/screens/educator/WeeklyTimesheetScreen';
import TimeOffRequestScreen  from './src/screens/educator/TimeOffRequestScreen';
import TimeOffRequestsScreen from './src/screens/educator/TimeOffRequestsScreen';
import TimeOffDetailScreen   from './src/screens/educator/TimeOffDetailScreen';
import RoomRatiosScreen      from './src/screens/educator/RoomRatiosScreen';
import RollCallScreen        from './src/screens/educator/RollCallScreen';
import MarkAbsentScreen      from './src/screens/educator/MarkAbsentScreen';
import LatePickupScreen      from './src/screens/educator/LatePickupScreen';
import RollCallCompleteScreen from './src/screens/educator/RollCallCompleteScreen';
import CredentialsScreen     from './src/screens/educator/CredentialsScreen';
import CredentialDetailScreen from './src/screens/educator/CredentialDetailScreen';
import CredentialRenewalScreen from './src/screens/educator/CredentialRenewalScreen';
import CredentialSubmittedScreen from './src/screens/educator/CredentialSubmittedScreen';
import PickupsScreen         from './src/screens/educator/PickupsScreen';
import VerifyPickupScreen    from './src/screens/educator/VerifyPickupScreen';
import PickupCompleteScreen  from './src/screens/educator/PickupCompleteScreen';
import UnauthorizedPickupScreen from './src/screens/educator/UnauthorizedPickupScreen';
import EventRsvpsScreen     from './src/screens/educator/EventRsvpsScreen';
import ChildConsentsScreen  from './src/screens/educator/ChildConsentsScreen';
import ClassroomConsentsScreen from './src/screens/educator/ClassroomConsentsScreen';
import InboxScreen           from './src/screens/educator/InboxScreen';
import ClassroomEditScreen   from './src/screens/educator/ClassroomEditScreen';
import MealMenuScreen        from './src/screens/educator/MealMenuScreen';
import StaffMessagesScreen   from './src/screens/educator/StaffMessagesScreen';
import StaffConversationScreen from './src/screens/educator/StaffConversationScreen';
import StaffNotificationsScreen from './src/screens/educator/StaffNotificationsScreen';
import StaffAbsenceDetailScreen from './src/screens/educator/StaffAbsenceDetailScreen';
import ParentHomeScreen      from './src/screens/parent/ParentHomeScreen';
import WeeklySummaryScreen   from './src/screens/parent/WeeklySummaryScreen';
import ParentDayRecapScreen  from './src/screens/parent/ParentDayRecapScreen';
import ParentMessagesScreen  from './src/screens/parent/ParentMessagesScreen';
import IncidentDetailScreen  from './src/screens/parent/IncidentDetailScreen';
import ParentIncidentsScreen from './src/screens/parent/ParentIncidentsScreen';
import IncidentAcknowledgedScreen from './src/screens/parent/IncidentAcknowledgedScreen';
import PickupPassScreen      from './src/screens/parent/PickupPassScreen';
import AuthorizedPickupsScreen from './src/screens/parent/AuthorizedPickupsScreen';
import ReportAbsenceScreen from './src/screens/parent/ReportAbsenceScreen';
import AbsenceSubmittedScreen from './src/screens/parent/AbsenceSubmittedScreen';
import EventDetailScreen    from './src/screens/parent/EventDetailScreen';
import ParentConsentsScreen from './src/screens/parent/ParentConsentsScreen';
import EnrollmentOfferScreen from './src/screens/parent/EnrollmentOfferScreen';
import ParentInquiryJourneyScreen from './src/screens/parent/ParentInquiryJourneyScreen';
import BillingHomeScreen from './src/screens/parent/BillingHomeScreen';
import ParentInvoiceScreen from './src/screens/parent/ParentInvoiceScreen';
import ParentPaymentMethodsScreen from './src/screens/parent/ParentPaymentMethodsScreen';
import ParentAddPaymentMethodScreen from './src/screens/parent/ParentAddPaymentMethodScreen';
import ParentStatementsScreen from './src/screens/parent/ParentStatementsScreen';
import PaymentReceiptScreen from './src/screens/parent/PaymentReceiptScreen';
import ParentMeScreen from './src/screens/parent/ParentMeScreen';
import ParentEditProfileScreen from './src/screens/parent/ParentEditProfileScreen';
import ParentNotificationSettingsScreen from './src/screens/parent/ParentNotificationSettingsScreen';
import ParentNotificationsScreen from './src/screens/parent/ParentNotificationsScreen';
import ChildrenGuardiansScreen from './src/screens/parent/ChildrenGuardiansScreen';
import ParentChildDetailsScreen from './src/screens/parent/ParentChildDetailsScreen';
import ParentPrivacyDataScreen from './src/screens/parent/ParentPrivacyDataScreen';
import ParentDocumentsScreen from './src/screens/parent/ParentDocumentsScreen';
import ParentDocumentUploadScreen from './src/screens/parent/ParentDocumentUploadScreen';
import ParentDocumentViewerScreen from './src/screens/parent/ParentDocumentViewerScreen';
import ParentDocumentSentScreen from './src/screens/parent/ParentDocumentSentScreen';
import ParentClosureNoticeScreen from './src/screens/parent/ParentClosureNoticeScreen';
import ParentClosuresScreen from './src/screens/parent/ParentClosuresScreen';
import ParentRoomMoveScreen from './src/screens/parent/ParentRoomMoveScreen';
import ParentChildInviteScreen from './src/screens/parent/ParentChildInviteScreen';
import AnnouncementsScreen   from './src/screens/shared/AnnouncementsScreen';
import MedicationScreen      from './src/screens/shared/MedicationScreen';
import ConsentScreen         from './src/screens/shared/ConsentScreen';
import AdminDashboardScreen  from './src/screens/admin/AdminDashboardScreen';
import AdminUsersScreen      from './src/screens/admin/AdminUsersScreen';
import AdminSettingsScreen   from './src/screens/admin/AdminSettingsScreen';

import { supabase } from './src/lib/supabase';
import { Ionicons } from '@expo/vector-icons';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function TabIcon({
  name,
  label,
  focused,
  badge,
  elevated = false,
  flat = false,
}) {
  return (
    <View style={[tabStyles.iconWrap, elevated && tabStyles.iconWrapElevated]}>
      <View style={[
        tabStyles.iconBg,
        focused && !flat && tabStyles.iconBgActive,
        elevated && tabStyles.iconBgElevated,
      ]}>
        <Ionicons
          name={elevated ? 'add' : (focused ? name : `${name}-outline`)}
          size={elevated ? 28 : 22}
          color={elevated ? colors.white : (focused ? colors.primary : colors.textMuted)}
        />
        {badge > 0 && (
          <View style={tabStyles.badge}>
            <Text style={tabStyles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[tabStyles.label, focused && tabStyles.labelActive, elevated && tabStyles.labelElevated]}
      >
        {label}
      </Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: { alignItems: 'center', gap: 3, paddingTop: 6, minWidth: 56 },
  iconWrapElevated: { marginTop: -29 },
  iconBg: {
    width: 44, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBgActive: { backgroundColor: colors.primaryLight },
  iconBgElevated: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.primary,
    borderWidth: 4, borderColor: colors.bg,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24, shadowRadius: 10, elevation: 8,
  },
  label: { fontSize: 11, color: colors.textMuted, fontFamily: fonts.regular },
  labelActive: { color: colors.primary, fontFamily: fonts.bold },
  labelElevated: { color: colors.textSecondary, fontFamily: fonts.bold, marginTop: 1 },
  badge: {
    position: 'absolute', top: -4, right: -6,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#EF4444', paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 10, color: '#fff', fontFamily: fonts.bold },
  educatorBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'visible',
    borderTopWidth: 1.5,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.surface,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 12,
  },
  educatorSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
});

const tabBarStyle = {
  height: 88, paddingBottom: 16, paddingTop: 5,
  borderTopWidth: 0,
  backgroundColor: colors.surface,
  elevation: 12,
  shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.08, shadowRadius: 12,
};

// ─── EDUCATOR TABS ────────────────────────────────────────────────────────────
const EDUCATOR_TAB_ICONS = {
  Roster: { name: 'people', label: 'Kids' },
  InboxTab: { name: 'chatbubbles', label: 'Inbox' },
  ManageTab: { name: 'school', label: 'Classroom' },
  ProfileTab: { name: 'person', label: 'Me' },
};

function EducatorTabBar({ state, descriptors, navigation, unreadCount }) {
  const insets = useSafeAreaInsets();
  const leftRoutes = state.routes.slice(0, 2);
  const rightRoutes = state.routes.slice(2);

  function renderRoute(route) {
    const focused = state.routes[state.index].key === route.key;
    const config = EDUCATOR_TAB_ICONS[route.name];
    const options = descriptors[route.key]?.options || {};

    function handlePress() {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    }

    return (
      <TouchableOpacity
        key={route.key}
        onPress={handlePress}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
        style={tabStyles.educatorSlot}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={options.tabBarAccessibilityLabel || config.label}
        accessibilityState={focused ? { selected: true } : {}}
      >
        <TabIcon
          name={config.name}
          label={config.label}
          focused={focused}
          flat
          badge={route.name === 'InboxTab' ? unreadCount : 0}
        />
      </TouchableOpacity>
    );
  }

  function openQuickLog() {
    navigation.getParent()?.navigate('QuickLog');
  }

  return (
    <View
      style={[
        tabStyles.educatorBar,
        {
          height: 70 + Math.max(insets.bottom, 12),
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      {leftRoutes.map(renderRoute)}
      <TouchableOpacity
        onPress={openQuickLog}
        style={tabStyles.educatorSlot}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel="Quick log"
        accessibilityHint="Opens the quick log sheet"
      >
        <TabIcon name="add" label="Quick log" focused={false} elevated />
      </TouchableOpacity>
      {rightRoutes.map(renderRoute)}
    </View>
  );
}

function EducatorTabs({ navigation }) {
  const { unreadCount } = useUnreadMessages();
  return (
    <>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <EducatorTabBar {...props} unreadCount={unreadCount} />}
      >
        <Tab.Screen name="Roster" component={RosterScreen}
          options={{ tabBarAccessibilityLabel: 'Kids' }} />
        <Tab.Screen name="InboxTab" component={InboxScreen}
          options={{ tabBarAccessibilityLabel: 'Inbox' }} />
        <Tab.Screen name="ManageTab" component={ManageScreen}
          options={{ tabBarAccessibilityLabel: 'Classroom' }} />
        <Tab.Screen name="ProfileTab" component={SettingsScreen}
          options={{ tabBarAccessibilityLabel: 'Me' }} />
      </Tab.Navigator>
      <RatioAlertGate navigation={navigation} />
    </>
  );
}

// ─── PARENT TABS ──────────────────────────────────────────────────────────────
function ParentTabs() {
  return <ParentTabsContent />;
}

function ParentTabsContent() {
  const { unreadCount } = useUnreadMessages();
  const notifications = useParentNotifications();
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle }}>
      <Tab.Screen name="ParentHome" component={ParentHomeScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="today" label="Today" focused={focused} badge={notifications.unreadCount} />, tabBarLabel: () => null }} />
      <Tab.Screen name="WeeklyTab" component={WeeklySummaryTabScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="bar-chart" label="Weekly" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="MessagesTab" component={ParentMessagesScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="chatbubbles" label="Chat" focused={focused} badge={unreadCount} />, tabBarLabel: () => null }} />
      <Tab.Screen name="ProfileTab" component={ParentMeScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="person" label="Me" focused={focused} />, tabBarLabel: () => null }} />
    </Tab.Navigator>
  );
}

function ParentConsentGate() {
  const { profile } = useAuth();
  const family = useParentFamily();
  const childInvite = useParentChildInvite();
  if (
    profile?.role !== 'parent'
    || childInvite.hydrating
    || childInvite.code
    || !family.pendingConsentChild
  ) return null;
  return (
    <ConsentScreen
      childId={family.pendingConsentChild.id}
      childName={family.pendingConsentChild.first_name}
      onDone={() => family.refresh({ silent: true }).catch(() => {})}
    />
  );
}

// ─── ADMIN TABS ───────────────────────────────────────────────────────────────
function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle }}>
      <Tab.Screen name="AdminDashboard" component={AdminDashboardScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="grid" label="Dashboard" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="Roster" component={RosterScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="people" label="Kids" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="ManageTab" component={ManageScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="school" label="Class" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="AdminUsers" component={AdminUsersScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="person-add" label="Users" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="AdminSettings" component={AdminSettingsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="settings" label="Settings" focused={focused} />, tabBarLabel: () => null }} />
    </Tab.Navigator>
  );
}

// Wrapper for weekly summary as a tab — supports multi-child switching
function WeeklySummaryTabScreen({ route }) {
  return <WeeklySummaryAutoScreen route={route} />;
}

function WeeklySummaryAutoScreen({ route }) {
  const family = useParentFamily();
  const requestedChildId = route?.params?.childId;

  useFocusEffect(React.useCallback(() => {
    family.refresh({ silent: true }).catch(() => {});
  }, [family.refresh]));

  React.useEffect(() => {
    if (!requestedChildId) return;
    const requestedChild = family.children.find((child) => child.id === requestedChildId);
    if (requestedChild && family.selectedChild?.id !== requestedChild.id) {
      family.selectChild(requestedChild);
    }
  }, [family.children, family.selectChild, family.selectedChild?.id, requestedChildId]);

  if (family.loading) return <LoadingScreen />;
  if (!family.children.length) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>No children linked</Text></View>;

  const selected = family.selectedChild || family.children[0];

  return (
    <View style={{ flex: 1 }}>
      {/* Child switcher tabs (show only if more than 1 child) */}
      {family.children.length > 1 && (
        <View style={childSwitcherStyles.row}>
          {family.children.map((child) => (
            <TouchableOpacity
              key={child.id}
              onPress={() => family.selectChild(child)}
              style={[childSwitcherStyles.tab, child.id === selected.id && childSwitcherStyles.tabActive]}
            >
              <Text style={[childSwitcherStyles.tabText, child.id === selected.id && childSwitcherStyles.tabTextActive]}>
                {child.first_name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <WeeklySummaryScreen
        route={{
          params: {
            childId: selected.id,
            childName: selected.first_name,
            weekDate: route?.params?.weekDate,
            viewMode: route?.params?.viewMode,
          },
        }}
      />
    </View>
  );
}

const childSwitcherStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  tab: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    marginRight: spacing.sm,
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: 14, fontFamily: fonts.regular, color: colors.textMuted },
  tabTextActive: { color: colors.primary, fontFamily: fonts.bold },
});

// ─── PROFILE ERROR FALLBACK ───────────────────────────────────────────────────
// Shown if a signed-in user has no profile row and self-heal failed.
function ProfileIssueScreen() {
  const { user, fetchProfile, signOut } = useAuth();
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@dailylog.app';
  const version = Constants.expoConfig?.version || '1.0.0';

  function contactSupport() {
    Linking.openURL(
      `mailto:${supportEmail}?subject=${encodeURIComponent('DailyLog profile support')}`
    );
  }

  return (
    <View style={styles.profileIssue}>
      <View style={styles.profileIssueContent}>
        <View style={styles.profileIssueIcon}>
          <Ionicons name="warning-outline" size={36} color={colors.amber} />
        </View>
        <Text style={styles.profileIssueTitle}>We couldn't load{'\n'}your profile</Text>
        <Text style={styles.profileIssueText}>
          Your account exists but its profile is missing. Try again, or sign out
          and contact your daycare.
        </Text>
        <View style={styles.profileIssueActions}>
          <Button
            label="Try again"
            onPress={() => user && fetchProfile(user.id)}
          />
          <Button label="Sign out" onPress={signOut} variant="ghost" />
        </View>
        <TouchableOpacity onPress={contactSupport} accessibilityRole="link">
          <Text style={styles.profileIssueSupport}>
            Still stuck? <Text style={styles.profileIssueSupportLink}>Contact support</Text>
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.profileIssueVersion}>DailyLog v{version}</Text>
    </View>
  );
}

// ─── ROOT NAVIGATOR ───────────────────────────────────────────────────────────
function RootNavigator() {
  const { user, profile, loading, recovery, profileFailed } = useAuth();
  const parentFamily = useParentFamily();
  const {
    code: inviteCode,
    accepted: acceptedInvite,
    hydrating: inviteHydrating,
    suspended: inviteSuspended,
    resumeInvite,
  } = useStaffInvite();
  const {
    code: enrollmentOfferCode,
    hydrating: enrollmentOfferHydrating,
  } = useEnrollmentOffer();
  const {
    code: enrollmentJourneyCode,
    centerId: inquiryCenterId,
    hydrating: enrollmentJourneyHydrating,
  } = useEnrollmentJourney();
  const {
    paymentId: linkedPaymentId,
    hydrating: paymentReceiptHydrating,
  } = usePaymentReceiptLink();
  const {
    code: parentChildInviteCode,
    hydrating: parentChildInviteHydrating,
  } = useParentChildInvite();
  usePushNotifications(user?.id, profile?.role);

  // First-launch welcome carousel
  const [welcomeSeen, setWelcomeSeen] = React.useState(null); // null = checking
  React.useEffect(() => {
    AsyncStorage.getItem(WELCOME_SEEN_KEY).then(v => setWelcomeSeen(!!v));
  }, []);

  // A deep link or notification may arrive while the auth/profile and
  // business-link providers are still hydrating. Once the relevant navigator
  // is committed, retry the queued destination against its mounted route list.
  React.useEffect(() => {
    const timer = setTimeout(flushPendingNavigation, 0);
    return () => clearTimeout(timer);
  }, [
    enrollmentJourneyHydrating,
    enrollmentOfferHydrating,
    inviteHydrating,
    loading,
    paymentReceiptHydrating,
    parentChildInviteHydrating,
    profile?.id,
    profile?.role,
    recovery,
    user?.id,
    welcomeSeen,
  ]);

  React.useEffect(() => {
    if (user && inviteCode && inviteSuspended) resumeInvite();
  }, [inviteCode, inviteSuspended, resumeInvite, user]);

  if (
    loading || welcomeSeen === null || inviteHydrating || parentChildInviteHydrating ||
    enrollmentOfferHydrating || enrollmentJourneyHydrating || paymentReceiptHydrating
  ) return <LoadingScreen />;

  if (profile?.role === 'parent' && parentFamily.loading) return <LoadingScreen />;

  const showInvite = Boolean(
    acceptedInvite || (inviteCode && (!inviteSuspended || user))
  );
  const showEnrollmentOffer = Boolean(enrollmentOfferCode);
  const showEnrollmentJourney = Boolean(enrollmentJourneyCode || inquiryCenterId);
  const showPaymentReceipt = Boolean(linkedPaymentId);
  const showParentChildInvite = Boolean(parentChildInviteCode);

  if (!user && !welcomeSeen && !showInvite && !showEnrollmentOffer && !showEnrollmentJourney && !showPaymentReceipt && !showParentChildInvite) {
    return <WelcomeScreen onDone={() => setWelcomeSeen(true)} />;
  }

  const needsOnboarding =
    (profile?.role === 'educator' && !profile?.classroom_id) ||
    (isAdminRole(profile?.role) && !profile?.daycare_id) ||
    (
      profile?.role === 'parent' &&
      user?.user_metadata?.setup_center_pending === true &&
      !profile?.daycare_id
    );

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {recovery ? (
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      ) : user && showPaymentReceipt ? (
        <Stack.Screen
          name="PaymentReceipt"
          component={PaymentReceiptScreen}
          initialParams={{ paymentId: linkedPaymentId }}
        />
      ) : showEnrollmentOffer ? (
        <Stack.Screen name="EnrollmentOffer" component={EnrollmentOfferScreen} />
      ) : showEnrollmentJourney ? (
        <Stack.Screen name="ParentInquiryJourney" component={ParentInquiryJourneyScreen} />
      ) : user && showParentChildInvite ? (
        <Stack.Screen name="ParentChildInvite" component={ParentChildInviteScreen} />
      ) : showInvite ? (
        <>
          <Stack.Screen name="StaffInvite" component={StaffInviteScreen} />
          <Stack.Screen
            name="InvitePrivacy"
            component={PrivacyScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="StaffTerms"
            component={StaffTermsScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
        </>
      ) : !user ? (
        <>
          <Stack.Screen name="Login"          component={LoginScreen} />
          <Stack.Screen name="Signup"         component={SignupScreen} />
          <Stack.Screen name="CenterSetupIntro" component={CenterSetupIntroScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <Stack.Screen name="Privacy"        component={PrivacyScreen} options={{ animation: 'slide_from_bottom' }} />
        </>
      ) : profileFailed ? (
        <Stack.Screen name="ProfileIssue" component={ProfileIssueScreen} />
      ) : needsOnboarding ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : isAdminRole(profile?.role) ? (
        <>
          <Stack.Screen name="AdminTabs"       component={AdminTabs} />
          <Stack.Screen name="DailyLog"        component={DailyLogScreen}        options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="DailyReportReview" component={DailyReportReviewScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildProfile"    component={ChildProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ClassroomEdit"   component={ClassroomEditScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="MealMenu"        component={MealMenuScreen}        options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentHub"     component={IncidentHubScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentReport"  component={IncidentReportScreen}  options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="IncidentRecord"  component={IncidentRecordScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="MyTime"          component={MyTimeScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="WeeklyTimesheet" component={WeeklyTimesheetScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TimeOffRequest"  component={TimeOffRequestScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TimeOffRequests" component={TimeOffRequestsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TimeOffDetail"   component={TimeOffDetailScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="RoomRatios"       component={RoomRatiosScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="RollCall"          component={RollCallScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="MarkAbsent"        component={MarkAbsentScreen}        options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="LatePickup"        component={LatePickupScreen}        options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="RollCallComplete"  component={RollCallCompleteScreen}  options={{ animation: 'fade' }} />
          <Stack.Screen name="Credentials"       component={CredentialsScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="CredentialDetail" component={CredentialDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="CredentialRenewal" component={CredentialRenewalScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="CredentialSubmitted" component={CredentialSubmittedScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="Pickups"          component={PickupsScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="VerifyPickup"     component={VerifyPickupScreen}     options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="PickupComplete"   component={PickupCompleteScreen}   options={{ animation: 'fade' }} />
          <Stack.Screen name="UnauthorizedPickup" component={UnauthorizedPickupScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="EventRsvps"     component={EventRsvpsScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildConsents"  component={ChildConsentsScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ClassroomConsents" component={ClassroomConsentsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile"     component={EditProfileScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffMessages"   component={StaffMessagesScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffConversation" component={StaffConversationScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffAbsenceDetail" component={StaffAbsenceDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"       component={MessagingScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Announcements"   component={AnnouncementsScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Medication"      component={MedicationScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"         component={PrivacyScreen}         options={{ animation: 'slide_from_bottom' }} />
        </>
      ) : profile?.role === 'educator' ? (
        <>
          <Stack.Screen name="EducatorTabs"    component={EducatorTabs} />
          <Stack.Screen name="QuickLog"         component={BulkLogScreen}        options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="DailyLog"        component={DailyLogScreen}        options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="DailyReportReview" component={DailyReportReviewScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildProfile"    component={ChildProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ClassroomEdit"   component={ClassroomEditScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="MealMenu"        component={MealMenuScreen}        options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentHub"     component={IncidentHubScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentReport"  component={IncidentReportScreen}  options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="IncidentRecord"  component={IncidentRecordScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="MyTime"          component={MyTimeScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="WeeklyTimesheet" component={WeeklyTimesheetScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TimeOffRequest"  component={TimeOffRequestScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TimeOffRequests" component={TimeOffRequestsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TimeOffDetail"   component={TimeOffDetailScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="RoomRatios"       component={RoomRatiosScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="RollCall"          component={RollCallScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="MarkAbsent"        component={MarkAbsentScreen}        options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="LatePickup"        component={LatePickupScreen}        options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="RollCallComplete"  component={RollCallCompleteScreen}  options={{ animation: 'fade' }} />
          <Stack.Screen name="Credentials"       component={CredentialsScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="CredentialDetail" component={CredentialDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="CredentialRenewal" component={CredentialRenewalScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="CredentialSubmitted" component={CredentialSubmittedScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="Pickups"          component={PickupsScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="VerifyPickup"     component={VerifyPickupScreen}     options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="PickupComplete"   component={PickupCompleteScreen}   options={{ animation: 'fade' }} />
          <Stack.Screen name="UnauthorizedPickup" component={UnauthorizedPickupScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="EventRsvps"     component={EventRsvpsScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildConsents"  component={ChildConsentsScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ClassroomConsents" component={ClassroomConsentsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile"     component={EditProfileScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffMessages"   component={StaffMessagesScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffConversation" component={StaffConversationScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffNotifications" component={StaffNotificationsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="StaffAbsenceDetail" component={StaffAbsenceDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"       component={MessagingScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Announcements"   component={AnnouncementsScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Medication"      component={MedicationScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"         component={PrivacyScreen}         options={{ animation: 'slide_from_bottom' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="ParentTabs"      component={ParentTabs} />
          <Stack.Screen name="WeeklySummary"   component={WeeklySummaryScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentDayRecap"  component={ParentDayRecapScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentDetail"  component={IncidentDetailScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentIncidents" component={ParentIncidentsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentAcknowledged" component={IncidentAcknowledgedScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="PickupPass"       component={PickupPassScreen}       options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="AuthorizedPickups" component={AuthorizedPickupsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ReportAbsence" component={ReportAbsenceScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="AbsenceSubmitted" component={AbsenceSubmittedScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="EventDetail"     component={EventDetailScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentConsents"  component={ParentConsentsScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="BillingHome" component={BillingHomeScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentInvoice" component={ParentInvoiceScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentPaymentMethods" component={ParentPaymentMethodsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentAddPaymentMethod" component={ParentAddPaymentMethodScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="ParentStatements" component={ParentStatementsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="PaymentReceipt" component={PaymentReceiptScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="ParentNotificationSettings" component={ParentNotificationSettingsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentNotifications" component={ParentNotificationsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildrenGuardians" component={ChildrenGuardiansScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentChildDetails" component={ParentChildDetailsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentChildInvite" component={ParentChildInviteScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ParentPrivacyData" component={ParentPrivacyDataScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentEditProfile" component={ParentEditProfileScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentDocuments" component={ParentDocumentsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentDocumentUpload" component={ParentDocumentUploadScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentDocumentViewer" component={ParentDocumentViewerScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentDocumentSent" component={ParentDocumentSentScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="ParentClosureNotice" component={ParentClosureNoticeScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ParentClosures" component={ParentClosuresScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ParentRoomMove" component={ParentRoomMoveScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"       component={MessagingScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Announcements"   component={AnnouncementsScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Medication"      component={MedicationScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"         component={PrivacyScreen}         options={{ animation: 'slide_from_bottom' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Lato_400Regular,
    Lato_700Bold,
    Lato_900Black,
  });

  React.useEffect(() => {
    if (fontError) console.warn('DailyLog fonts failed to load:', fontError);
  }, [fontError]);

  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider>
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ParentFamilyProvider>
          <ParentNotificationsProvider>
            <EnrollmentOfferProvider>
              <EnrollmentJourneyProvider>
                <PaymentReceiptLinkProvider>
                  <ParentChildInviteProvider>
                    <StaffInviteProvider>
                      <ClassroomProvider>
                      <NavigationContainer
                        ref={navigationRef}
                        onReady={flushPendingNavigation}
                        onStateChange={flushPendingNavigation}
                      >
                        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
                          <ForceUpdateGate>
                            <BiometricGate>
                              <OfflineBanner />
                              <RootNavigator />
                              <ParentConsentGate />
                              <PushPrimingModal />
                              <ToastHost />
                            </BiometricGate>
                          </ForceUpdateGate>
                        </SafeAreaView>
                      </NavigationContainer>
                      </ClassroomProvider>
                    </StaffInviteProvider>
                  </ParentChildInviteProvider>
                </PaymentReceiptLinkProvider>
              </EnrollmentJourneyProvider>
            </EnrollmentOfferProvider>
          </ParentNotificationsProvider>
        </ParentFamilyProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  profileIssue: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
    backgroundColor: colors.bg,
  },
  profileIssueContent: {
    width: '100%',
    maxWidth: 440,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIssueIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberLight,
    marginBottom: spacing.lg,
  },
  profileIssueTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  profileIssueText: {
    maxWidth: 310,
    fontSize: 14.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 23,
  },
  profileIssueActions: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  profileIssueSupport: {
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: spacing.lg,
  },
  profileIssueSupportLink: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  profileIssueVersion: {
    color: '#C6D5E9',
    fontFamily: fonts.regular,
    fontSize: 12,
  },
});
