import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, SafeAreaView, StyleSheet } from 'react-native';

import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { ClassroomProvider } from './src/hooks/useClassroom';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { LoadingScreen } from './src/components/ui';
import { OfflineBanner } from './src/components/OfflineBanner';
import { colors } from './src/theme';

import LoginScreen          from './src/screens/shared/LoginScreen';
import SignupScreen         from './src/screens/shared/SignupScreen';
import SettingsScreen       from './src/screens/shared/SettingsScreen';
import PrivacyScreen        from './src/screens/shared/PrivacyScreen';
import MessagingScreen      from './src/screens/shared/MessagingScreen';
import OnboardingScreen     from './src/screens/educator/OnboardingScreen';
import RosterScreen         from './src/screens/educator/RosterScreen';
import DailyLogScreen       from './src/screens/educator/DailyLogScreen';
import ManageScreen         from './src/screens/educator/ManageScreen';
import EditProfileScreen    from './src/screens/educator/EditProfileScreen';
import BulkLogScreen        from './src/screens/educator/BulkLogScreen';
import ChildProfileScreen   from './src/screens/educator/ChildProfileScreen';
import ParentHomeScreen     from './src/screens/parent/ParentHomeScreen';
import WeeklySummaryScreen  from './src/screens/parent/WeeklySummaryScreen';
import ParentMessagesScreen from './src/screens/parent/ParentMessagesScreen';

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

// Wrapper for weekly summary as a tab — auto-selects first child
function WeeklySummaryTabScreen() {
  return <WeeklySummaryAutoScreen />;
}

function WeeklySummaryAutoScreen() {
  const { profile } = useAuth();
  const [childId, setChildId] = React.useState(null);
  const [childName, setChildName] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      const { data } = await require('./src/lib/supabase').supabase
        .from('parent_children')
        .select('child:children(id, first_name)')
        .eq('parent_id', profile.id)
        .limit(1);
      if (data?.[0]?.child) {
        setChildId(data[0].child.id);
        setChildName(data[0].child.first_name);
      }
      setLoading(false);
    }
    if (profile) load();
  }, [profile]);

  if (loading) return <LoadingScreen />;
  if (!childId) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>No children linked</Text></View>;

  return <WeeklySummaryScreen route={{ params: { childId, childName } }} />;
}

// ─── ROOT NAVIGATOR ───────────────────────────────────────────────────────────
function RootNavigator() {
  const { user, profile, loading } = useAuth();
  usePushNotifications(user?.id);
  if (loading) return <LoadingScreen />;

  const needsOnboarding = profile?.role === 'educator' && !profile?.classroom_id;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <>
          <Stack.Screen name="Login"  component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
        </>
      ) : needsOnboarding ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : profile?.role === 'educator' ? (
        <>
          <Stack.Screen name="EducatorTabs"  component={EducatorTabs} />
          <Stack.Screen name="DailyLog"      component={DailyLogScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChildProfile"  component={ChildProfileScreen}   options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile"   component={EditProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"     component={MessagingScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"       component={PrivacyScreen}        options={{ animation: 'slide_from_bottom' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="ParentTabs"    component={ParentTabs} />
          <Stack.Screen name="WeeklySummary" component={WeeklySummaryScreen}  options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Messaging"     component={MessagingScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile"   component={EditProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"       component={PrivacyScreen}        options={{ animation: 'slide_from_bottom' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ClassroomProvider>
        <NavigationContainer>
          <SafeAreaView style={styles.root}>
            <OfflineBanner />
            <RootNavigator />
          </SafeAreaView>
        </NavigationContainer>
      </ClassroomProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
