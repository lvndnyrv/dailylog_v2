import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { Button } from './ui';
import { colors, spacing } from '../theme';

/** Compares semver strings: returns -1 / 0 / 1 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Blocks the app with an upgrade screen when the installed version is
 * below app_config.min_app_version. Fails open (network error → app runs).
 */
export function ForceUpdateGate({ children }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const { data } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'min_app_version')
          .maybeSingle();
        if (!data?.value) return;

        const current = Constants?.expoConfig?.version || '0.0.0';
        if (compareVersions(current, data.value) < 0) setBlocked(true);
      } catch (e) {
        // Fail open — never block on a network error
      }
    }
    check();
  }, []);

  if (!blocked) return children;

  const storeUrl = Platform.OS === 'ios'
    ? 'https://apps.apple.com' // replace with real App Store URL
    : 'https://play.google.com/store'; // replace with real Play Store URL

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⬆️</Text>
      <Text style={styles.title}>Update required</Text>
      <Text style={styles.body}>
        This version of DailyLog is no longer supported. Please update to
        the latest version to keep receiving your daycare updates.
      </Text>
      <Button
        label="Update now"
        onPress={() => Linking.openURL(storeUrl)}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', padding: spacing.xxl,
  },
  icon: { fontSize: 56, marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  body: {
    fontSize: 15, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 22, marginBottom: spacing.xl,
  },
});

