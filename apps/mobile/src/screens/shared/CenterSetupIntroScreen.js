import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthArtwork } from '../../components/AuthVisuals';
import { Button } from '../../components/ui';
import { colors, fonts, spacing } from '../../theme';

const BENEFITS = [
  'Unlimited classrooms and educator invites',
  'Daily reports sent to parents automatically',
  'Menus, announcements and chat in one place',
];

export default function CenterSetupIntroScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.artworkWrap}>
        <AuthArtwork style={styles.artwork} />
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Run your daycare{'\n'}on DailyLog</Text>

        <View style={styles.benefits}>
          {BENEFITS.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <View style={styles.checkCircle}>
                <Ionicons name="checkmark" size={14} color={colors.success} />
              </View>
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Button
            label="Start setup"
            onPress={() => navigation.navigate('Signup', { centerSetup: true })}
          />
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
            style={styles.signInAction}
          >
            <Text style={styles.signInText}>
              Already registered? <Text style={styles.signInLink}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  artworkWrap: {
    height: 300,
    marginTop: -60,
    backgroundColor: '#E3EDFA',
    overflow: 'hidden',
  },
  artwork: {
    height: 300,
    borderRadius: 0,
    marginTop: 60,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 26,
    paddingBottom: 28,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 27,
    lineHeight: 34,
    letterSpacing: -0.45,
  },
  benefits: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
  },
  benefitText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    marginTop: 'auto',
    gap: spacing.md,
  },
  signInAction: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  signInLink: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
});
