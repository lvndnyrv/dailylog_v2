import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../theme';

export function BrandMark({ stacked = false, style }) {
  return (
    <View style={[styles.brand, stacked && styles.brandStacked, style]}>
      <View style={[styles.brandIcon, stacked && styles.brandIconLarge]}>
        <Ionicons
          name="clipboard-outline"
          size={stacked ? 27 : 21}
          color={colors.white}
        />
      </View>
      <View style={stacked && styles.brandCopyCentered}>
        <Text style={[styles.brandName, stacked && styles.brandNameLarge]}>DailyLog</Text>
        {stacked && (
          <Text style={styles.brandTagline}>Daycare daily reports, made simple</Text>
        )}
      </View>
    </View>
  );
}

export function AuthBackButton({ onPress, label }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.backButton}
      activeOpacity={0.65}
      accessibilityRole="button"
      accessibilityLabel={label || 'Go back'}
    >
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      {label ? <Text style={styles.backLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

export function AuthArtwork({ compact = false, style }) {
  return (
    <View
      style={[styles.artwork, compact && styles.artworkCompact, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.artBlobLarge} />
      <View style={styles.artBlobSmall} />
      <View style={styles.artSparkleOne}>
        <Ionicons name="sparkles" size={20} color={colors.primary} />
      </View>
      <View style={styles.artBoard}>
        <View style={styles.artBoardLineWide} />
        <View style={styles.artBoardLine} />
        <View style={styles.artBoardBadge}>
          <Ionicons name="checkmark" size={14} color={colors.white} />
        </View>
      </View>
      <View style={[styles.person, styles.personLeft]}>
        <View style={styles.personHead}>
          <View style={styles.personHairLeft} />
        </View>
        <View style={[styles.personBody, styles.personBodyBlue]} />
      </View>
      <View style={[styles.person, styles.personRight]}>
        <View style={styles.personHead}>
          <View style={styles.personHairRight} />
        </View>
        <View style={[styles.personBody, styles.personBodyGold]} />
      </View>
      <View style={styles.artGround} />
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandStacked: {
    flexDirection: 'column',
    gap: 8,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  brandIconLarge: {
    width: 44,
    height: 44,
    borderRadius: 13,
  },
  brandCopyCentered: {
    alignItems: 'center',
  },
  brandName: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  brandNameLarge: {
    fontSize: 24,
  },
  brandTagline: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 13.5,
    marginTop: 1,
  },
  backButton: {
    minWidth: 40,
    minHeight: 40,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
    paddingHorizontal: 8,
    borderRadius: radius.full,
  },
  backLabel: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 14,
    marginLeft: 2,
  },
  artwork: {
    height: 190,
    overflow: 'hidden',
    borderRadius: radius.xl,
    backgroundColor: '#E8F1FC',
    position: 'relative',
  },
  artworkCompact: {
    height: 110,
    borderRadius: 18,
  },
  artBlobLarge: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: '#D7E7FA',
    left: -30,
    top: 16,
  },
  artBlobSmall: {
    position: 'absolute',
    width: 115,
    height: 115,
    borderRadius: 58,
    backgroundColor: '#F8EACD',
    right: -14,
    top: -34,
  },
  artSparkleOne: {
    position: 'absolute',
    left: 35,
    top: 28,
    opacity: 0.72,
  },
  artBoard: {
    position: 'absolute',
    width: 116,
    height: 82,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    right: 36,
    top: 34,
    padding: spacing.md,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  artBoardLineWide: {
    width: 66,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primaryLight,
    marginBottom: 8,
  },
  artBoardLine: {
    width: 46,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.borderSoft,
  },
  artBoardBadge: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    right: 10,
    bottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
  },
  person: {
    position: 'absolute',
    alignItems: 'center',
    bottom: 18,
  },
  personLeft: {
    left: 54,
  },
  personRight: {
    left: 112,
    bottom: 12,
  },
  personHead: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: '#C98F70',
    overflow: 'hidden',
    zIndex: 2,
  },
  personHairLeft: {
    width: 38,
    height: 17,
    borderRadius: 18,
    backgroundColor: colors.textPrimary,
    marginTop: -2,
    marginLeft: -2,
  },
  personHairRight: {
    width: 36,
    height: 20,
    borderRadius: 18,
    backgroundColor: '#4B342C',
    marginTop: -4,
  },
  personBody: {
    width: 52,
    height: 58,
    borderTopLeftRadius: 23,
    borderTopRightRadius: 23,
    borderBottomLeftRadius: 11,
    borderBottomRightRadius: 11,
    marginTop: -3,
  },
  personBodyBlue: {
    backgroundColor: colors.primary,
  },
  personBodyGold: {
    backgroundColor: '#E3AB4E',
  },
  artGround: {
    position: 'absolute',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#BED4EE',
    left: 32,
    right: 30,
    bottom: 12,
  },
});
