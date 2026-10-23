import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, spacing } from '../../theme';

export default function FamilyScreenHeader({ navigation, title, subtitle, onBack, action, dark = false }) {
  function goBack() {
    if (onBack) return onBack();
    if (navigation?.canGoBack?.()) return navigation.goBack();
    navigation?.navigate('ParentTabs', { screen: 'ParentHome' });
  }

  return (
    <View style={[styles.header, dark && styles.darkHeader]}>
      <TouchableOpacity
        style={[styles.back, dark && styles.darkBack]}
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Back to previous page"
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={21} color={dark ? colors.white : colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, dark && styles.darkEyebrow]}>FAMILY DAILY LOG</Text>
        <Text style={[styles.title, dark && styles.darkTitle]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, dark && styles.darkSubtitle]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {action || null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    backgroundColor: colors.bg,
  },
  darkHeader: { backgroundColor: '#132B4A' },
  back: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  darkBack: { borderColor: '#FFFFFF33', backgroundColor: '#FFFFFF19' },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 9, fontFamily: fonts.bold, letterSpacing: 1.2, color: colors.success, marginBottom: 2 },
  darkEyebrow: { color: '#A7D9BE' },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, lineHeight: 24 },
  darkTitle: { color: colors.white },
  subtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  darkSubtitle: { color: '#B7CCE6' },
});
