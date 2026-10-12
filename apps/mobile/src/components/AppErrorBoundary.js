import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Button } from './ui';
import { colors, fonts, spacing } from '../theme';
import { openConfiguredSupport } from '../lib/support';
import { reportClientError } from '../lib/clientErrors';

export class AppErrorBoundary extends React.Component {
  state = { error: null, reportRef: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('DailyLog render failure', error, info?.componentStack);
    reportClientError('render_failure').then((reportRef) => {
      if (reportRef) this.setState({ reportRef });
    });
  }

  retry = () => {
    this.setState({ error: null, reportRef: null });
  };

  contactSupport = () => {
    openConfiguredSupport(
      `DailyLog app recovery${this.state.reportRef ? ` ${this.state.reportRef}` : ''}`,
      `Contact your childcare center administrator. ${this.state.reportRef ? `Share reference ${this.state.reportRef}, ` : ''}your app version, and what you were doing—never your password or a child's private records.`,
    );
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen} accessibilityLiveRegion="assertive">
        <View style={styles.content}>
          <View style={styles.icon}>
            <Ionicons name="refresh-circle-outline" size={42} color={colors.primary} />
          </View>
          <Text style={styles.title}>DailyLog needs a fresh start</Text>
          <Text style={styles.body}>
            Nothing you already saved was removed. Try opening this screen again. If the problem
            returns, contact support and tell us what you were doing.
          </Text>
          {this.state.reportRef ? (
            <Text style={styles.reference}>Support reference {this.state.reportRef}</Text>
          ) : null}
          <View style={styles.actions}>
            <Button label="Try again" onPress={this.retry} />
            <TouchableOpacity
              accessibilityRole="link"
              onPress={this.contactSupport}
              style={styles.supportButton}
            >
              <Text style={styles.supportText}>Contact support</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.version}>DailyLog v{Constants.expoConfig?.version || '1.0.0'}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 25,
    lineHeight: 31,
    textAlign: 'center',
  },
  body: {
    maxWidth: 340,
    marginTop: spacing.md,
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  actions: { width: '100%', gap: spacing.sm, marginTop: spacing.xxl },
  reference: {
    marginTop: spacing.md,
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  supportButton: { alignItems: 'center', paddingVertical: spacing.md },
  supportText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  version: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12 },
});
