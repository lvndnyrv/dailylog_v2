import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { ClassroomProvider } from './src/hooks/useClassroom';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { LoadingScreen, Button } from './src/components/ui';
import { OfflineBanner } from './src/components/OfflineBanner';
import { ToastHost } from './src/components/Toast';
import { navigationRef } from './src/lib/navigationRef';
import { handleAuthUrl } from './src/lib/authLinks';
import { colors, spacing } from './src/theme';

import LoginScreen          from './src/screens/shared/LoginScreen';
import SignupScreen         from './src/screens/shared/SignupScreen';
import ForgotPasswordScreen from './src/screens/shared/ForgotPasswordScreen';
import ResetPasswordScreen  from './src/screens/shared/ResetPasswordScreen';
import SettingsScreen       from './src/screens/shared/SettingsScreen';
import PrivacyScreen        from './src/screens/shared/PrivacyScreen';
import MessagingScreen      from './src/screens/shared/MessagingScreen';
import OnboardingScreen      from './src/screens/educator/OnboardingScreen';
import RosterScreen          from './src/screens/educator/RosterScreen';
import DailyLogScreen        from './src/screens/educator/DailyLogScreen';
import ManageScreen          from './src/screens/educator/ManageScreen';
import EditProfileScreen     from './src/screens/educator/EditProfileScreen';
import BulkLogScreen         from './src/screens/educator/BulkLogScreen';
import ChildProfileScreen    from './src/screens/educator/ChildProfileScreen';
import IncidentReportScreen  from './src/screens/educator/IncidentReportScreen';
import InboxScreen           from './src/screens/educator/InboxScreen';
import ParentHomeScreen      from './src/screens/parent/ParentHomeScreen';
import WeeklySummaryScreen   from './src/screens/parent/WeeklySummaryScreen';
import ParentMessagesScreen  from './src/screens/parent/ParentMessagesScreen';
import IncidentDetailScreen  from './src/screens/parent/IncidentDetailScreen';
import AnnouncementsScreen   from './src/screens/shared/AnnouncementsScreen';
import MedicationScreen      from './src/screens/shared/MedicationScreen';
import AdminDashboardScreen  from './src/screens/admin/AdminDashboardScreen';
import AdminUsersScreen      from './src/screens/admin/AdminUsersScreen';
import AdminSettingsScreen   from './src/screens/admin/AdminSettingsScreen';

import { supabase } from './src/lib/supabase';
import { Ionicons } from '@expo/vector-icons';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function TabIcon({ name, label, focused }) {
  return (
    <View style={tabStyles.iconWrap}>
      <View style={[tabStyles.iconBg, focused && tabStyles.iconBgActive]}>
        <Ionicons
          name={focused ? name : `${name}-outline`}
          size={22}
          color={focused ? colors.primary : colors.textMuted}
        />
      </View>
      <Text numberOfLines={1} style={[tabStyles.label, focused && tabStyles.labelActive]}>{label}</Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: { alignItems: 'center', gap: 3, paddingTop: 6, minWidth: 56 },
  iconBg: {
    width: 44, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBgActive: { backgroundColor: colors.primaryLight },
  label: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  labelActive: { color: colors.primary, fontWeight: '600' },
});

const tabBarStyle = {
  height: 84, paddingBottom: 16, paddingTop: 4,
  borderTopWidth: 0,
  backgroundColor: colors.surface,
  elevation: 12,
  shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.08, shadowRadius: 12,
};

// ─── EDUCATOR TABS ────────────────────────────────────────────────────────────
function EducatorTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle }}>
      <Tab.Screen name="Roster" component={RosterScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="people" label="Kids" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="BulkTab" component={BulkLogScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="flash" label="Bulk" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="InboxTab" component={InboxScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="chatbubbles" label="Inbox" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="ManageTab" component={ManageScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="school" label="Class" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="ProfileTab" component={SettingsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="person" label="Me" focused={focused} />, tabBarLabel: () => null }} />
    </Tab.Navigator>
  );
}

// ─── PARENT TABS ──────────────────────────────────────────────────────────────
function ParentTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle }}>
      <Tab.Screen name="ParentHome" component={ParentHomeScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="today" label="Today" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="WeeklyTab" component={WeeklySummaryTabScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="bar-chart" label="Weekly" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="MessagesTab" component={ParentMessagesScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="chatbubbles" label="Chat" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="ProfileTab" component={SettingsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="person" label="Me" focused={focused} />, tabBarLabel: () => null }} />
    </Tab.Navigator>
  );
}

// ─── ADMIN TABS ───────────────────────────────────────────────────────────────
function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle }}>
      <Tab.Screen name="AdminDashboard" component={AdminDashboardScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="grid" label="Dashboard" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="AdminUsers" component={AdminUsersScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="people" label="Users" focused={focused} />, tabBarLabel: () => null }} />
      <Tab.Screen name="AdminSettings" component={AdminSettingsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon name="settings" label="Settings" focused={focused} />, tabBarLabel: () => null }} />
    </Tab.Navigator>
  );
}

// Wrapper for weekly summary as a tab — supports multi-child switching
function WeeklySummaryTabScreen() {
  return <WeeklySummaryAutoScreen />;
}

function WeeklySummaryAutoScreen() {
  const { profile } = useAuth();
  const [children, setChildren] = React.useState([]);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('parent_children')
        .select('child:children(id, first_name)')
        .eq('parent_id', profile.id);
      const kids = (data || []).map(r => r.child).filter(Boolean);
      setChildren(kids);
      setLoading(false);
    }
    if (profile) load();
  }, [profile]);

  if (loading) return <LoadingScreen />;
  if (!children.length) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>No children linked</Text></View>;

  const selected = children[selectedIdx] || children[0];

  return (
    <View style={{ flex: 1 }}>
      {/* Child switcher tabs (show only if more than 1 child) */}
      {children.length > 1 && (
        <View style={childSwitcherStyles.row}>
          {children.map((child, i) => (
            <TouchableOpacity
              key={child.id}
              onPress={() => setSelectedIdx(i)}
              style={[childSwitcherStyles.tab, i === selectedIdx && childSwitcherStyles.tabActive]}
            >
              <Text style={[childSwitcherStyles.tabText, i === selectedIdx && childSwitcherStyles.tabTextActive]}>
                {child.first_name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <WeeklySummaryScreen route={{ params: { childId: selected.id, childName: selected.first_name } }} />
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
  tabText: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  tabTextActive: { color: colors.primary, fontWeight: '600' },
});

// ─── PROFILE ERROR FALLBACK ───────────────────────────────────────────────────
// Shown if a signed-in user has no profile row and self-heal failed.
function ProfileIssueScreen() {
  const { user, fetchProfile, signOut } = useAuth();
  return (
    <View style={styles.profileIssue}>
      <Text style={styles.profileIssueIcon}>⚠️</Text>
      <Text style={styles.profileIssueTitle}>We couldn't load your profile</Text>
      <Text style={styles.profileIssueText}>
        Your account exists but its profile is missing. Try again, or sign out
        and contact your daycare.
      </Text>
      <Button label="Try again" onPress={() => user && fetchProfile(user.id)} style={styles.profileIssueBtn} />
      <Button label="Sign out" onPress={signOut} variant="ghost" style={styles.profileIssueBtn} />
    </View>
  );
}

// ─── ROOT NAVIGATOR ───────────────────────────────────────────────────────────
function RootNavigator() {
  const { user, profile, loading, recovery } = useAuth();
  usePushNotifications(user?.id);
  if (loading) return <LoadingScreen />;

  const needsOnboarding = profile?.role === 'educator' && !profile?.classroom_id;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <>
          <Stack.Screen name="Login"          component={LoginScreen} />
          <Stack.Screen name="Signup"         component={SignupScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      ) : recovery ? (
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      ) : !profile ? (
        <Stack.Screen name="ProfileIssue" component={ProfileIssueScreen} />
      ) : needsOnboarding ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : profile?.role === 'admin' ? (
        <>
          <Stack.Screen name="AdminTabs"       component={AdminTabs} />
          <Stack.Screen name="Announcements"   component={AnnouncementsScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildProfile"    component={ChildProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Medication"      component={MedicationScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile"     component={EditProfileScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"         component={PrivacyScreen}         options={{ animation: 'slide_from_bottom' }} />
        </>
      ) : profile?.role === 'educator' ? (
        <>
          <Stack.Screen name="EducatorTabs"    component={EducatorTabs} />
          <Stack.Screen name="DailyLog"        component={DailyLogScreen}        options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildProfile"    component={ChildProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentReport"  component={IncidentReportScreen}  options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="EditProfile"     component={EditProfileScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"       component={MessagingScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Announcements"   component={AnnouncementsScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Medication"      component={MedicationScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"         component={PrivacyScreen}         options={{ animation: 'slide_from_bottom' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="ParentTabs"      component={ParentTabs} />
          <Stack.Screen name="WeeklySummary"   component={WeeklySummaryScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="IncidentDetail"  component={IncidentDetailScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"       component={MessagingScreen}       options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Announcements"   component={AnnouncementsScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Medication"      component={MedicationScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile"     component={EditProfileScreen}     options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"         component={PrivacyScreen}         options={{ animation: 'slide_from_bottom' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  // Complete Supabase auth deep links (magic-link invites, password recovery)
  React.useEffect(() => {
    Linking.getInitialURL().then(url => { if (url) handleAuthUrl(url); });
    const sub = Linking.addEventListener('url', ({ url }) => handleAuthUrl(url));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ClassroomProvider>
          <NavigationContainer ref={navigationRef}>
            <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
              <OfflineBanner />
              <RootNavigator />
              <ToastHost />
            </SafeAreaView>
          </NavigationContainer>
        </ClassroomProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  profileIssue: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: spacing.xl, backgroundColor: colors.bg,
  },
  profileIssueIcon: { fontSize: 40, marginBottom: spacing.md },
  profileIssueTitle: {
    fontSize: 18, fontWeight: '700', color: colors.textPrimary,
    marginBottom: spacing.sm, textAlign: 'center',
  },
  profileIssueText: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 20, marginBottom: spacing.xl,
  },
  profileIssueBtn: { alignSelf: 'stretch', marginBottom: spacing.sm },
});
