import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui';
import { colors, spacing } from '../theme';

export const BIOMETRIC_KEY = 'dailylog:biometric_lock';

/** Returns whether the device supports biometrics (has hardware + enrolled). */
export async function biometricsAvailable() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  return LocalAuthentication.isEnrolledAsync();
}

/**
 * App-lock: when the user has enabled biometric lock in Settings,
 * require Face ID / fingerprint on cold start and when returning
 * from background.
 */
export function BiometricGate({ children }) {
  const { user } = useAuth();
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const appState = useRef(AppState.currentState);

  async function authenticate() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock DailyLog',
      cancelLabel: 'Cancel',
    });
    if (result.success) setLocked(false);
  }

  useEffect(() => {
    async function init() {
      if (!user) { setChecking(false); setLocked(false); return; }
      const enabled = await AsyncStorage.getItem(BIOMETRIC_KEY);
      if (enabled === 'on' && await biometricsAvailable()) {
        setLocked(true);
        setChecking(false);
        authenticate();
      } else {
        setChecking(false);
      }
    }
    init();
  }, [user?.id]);

  // Re-lock when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (appState.current.match(/background/) && next === 'active' && user) {
        const enabled = await AsyncStorage.getItem(BIOMETRIC_KEY);
        if (enabled === 'on' && await biometricsAvailable()) {
          setLocked(true);
          authenticate();
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [user?.id]);

  if (checking) return null;
  if (!locked) return children;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔐</Text>
      <Text style={styles.title}>DailyLog is locked</Text>
      <Text style={styles.body}>Use Face ID or your fingerprint to unlock.</Text>
      <Button label="Unlock" onPress={authenticate} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', padding: spacing.xxl,
  },
  icon: { fontSize: 56, marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  body: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xl },
});

