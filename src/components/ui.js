import React, { useState as useLocalState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';

// ---- CHIP (toggle button) ----
export function Chip({ label, selected, onPress, color = colors.primary, lightColor }) {
  const bg = lightColor || colors.primaryLight;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: bg, borderColor: color }]}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, selected && { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---- SECTION CARD ----
export function Section({ title, icon, children, style }) {
  return (
    <View style={[styles.section, style]}>
      <Text style={styles.sectionTitle}>{icon}  {title}</Text>
      {children}
    </View>
  );
}

// ---- PRIMARY BUTTON ----
export function Button({ label, onPress, loading, disabled, variant = 'primary', style }) {
  const bg = variant === 'primary' ? colors.primary
    : variant === 'danger' ? colors.danger
    : 'transparent';
  const textColor = variant === 'ghost' ? colors.primary : colors.white;
  const border = variant === 'ghost' ? { borderWidth: 1.5, borderColor: colors.primary } : {};

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.button, { backgroundColor: bg }, border, style]}
      activeOpacity={0.8}
      disabled={loading || disabled}
    >
      {loading
        ? <ActivityIndicator color={textColor} />
        : <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

// ---- TEXT INPUT ----
export function Input({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline, error, style, ...rest }) {
  const [showPassword, setShowPassword] = useLocalState(false);
  const isPassword = secureTextEntry;

  return (
    <View style={[styles.inputWrap, style]}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View style={[styles.inputRow, error && styles.inputError]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPassword && !showPassword}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
          {...rest}
          style={[styles.inputInner, multiline && styles.inputMulti]}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setShowPassword(p => !p)}
            style={styles.eyeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.inputErrorText}>{error}</Text>}
    </View>
  );
}

// ---- PASSWORD STRENGTH METER ----
export function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: colors.border };
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { score: 1, label: 'Weak', color: colors.danger };
  if (score === 2) return { score: 2, label: 'Fair', color: colors.amber };
  if (score === 3) return { score: 3, label: 'Good', color: colors.amber };
  return { score: 4, label: 'Strong', color: colors.primary };
}

export function PasswordStrength({ password }) {
  if (!password) return null;
  const { score, label, color } = getPasswordStrength(password);
  return (
    <View style={styles.pwStrengthWrap}>
      <View style={styles.pwStrengthBars}>
        {[1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={[styles.pwStrengthBar, { backgroundColor: i <= score ? color : colors.border }]}
          />
        ))}
      </View>
      <Text style={[styles.pwStrengthLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ---- ROW (for entry lists) ----
export function Row({ children, style }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// ---- BADGE ----
export function Badge({ label, color = colors.primary, bg }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg || colors.primaryLight }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ---- ALLERGY BADGE ----
// Compact warning badge shown wherever a child with allergies appears.
export function AllergyBadge({ allergies, compact }) {
  if (!allergies?.length) return null;
  return (
    <View style={styles.allergyBadge} accessibilityLabel={`Allergies: ${allergies.join(', ')}`}>
      <Text style={styles.allergyBadgeText} numberOfLines={1}>
        ⚠️ {compact ? allergies.length : allergies.join(', ')}
      </Text>
    </View>
  );
}

// ---- EMPTY STATE ----
export function EmptyState({ icon, message }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

// ---- LOADING SCREEN ----
export function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

// ---- DIVIDER ----
export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  button: {
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  inputWrap: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  inputInner: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    fontSize: 15,
    color: colors.textPrimary,
  },
  eyeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputMulti: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: spacing.md,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputErrorText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: spacing.xs,
    fontWeight: '500',
  },
  pwStrengthWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: -spacing.xs, marginBottom: spacing.md,
  },
  pwStrengthBars: { flexDirection: 'row', gap: 4, flex: 1 },
  pwStrengthBar: { flex: 1, height: 4, borderRadius: 2 },
  pwStrengthLabel: { fontSize: 12, fontWeight: '600', width: 48, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  allergyBadge: {
    backgroundColor: colors.dangerLight,
    borderWidth: 1,
    borderColor: colors.danger + '55',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
    maxWidth: 180,
  },
  allergyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.danger,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  loadingScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
});
