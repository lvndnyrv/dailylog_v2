import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  completeMobilePickup,
  verifyMobilePickupPass,
} from '../../hooks/usePickupVerification';
import { completeMobileLatePickup } from '../../hooks/useRollCall';
import { colors, fonts, radius, spacing } from '../../theme';

export default function VerifyPickupScreen({ navigation, route }) {
  const expectedPickup = route.params?.pickup || null;
  const latePickup = route.params?.latePickup || null;
  const [permission, requestPermission] = useCameraPermissions();
  const [manualMode, setManualMode] = useState(false);
  const [code, setCode] = useState('');
  const [matched, setMatched] = useState(null);
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const scanLock = useRef(false);

  const verify = useCallback(async ({ token, manualCode }) => {
    if (scanLock.current || verifying) return;
    scanLock.current = true;
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyMobilePickupPass({
        token,
        code: manualCode,
        expectedChildId: expectedPickup?.child_id,
      });
      setMatched(result);
      setManualMode(false);
    } catch (verifyError) {
      setError(verifyError.message);
      setTimeout(() => { scanLock.current = false; }, 900);
    } finally {
      setVerifying(false);
    }
  }, [expectedPickup?.child_id, verifying]);

  async function confirmCheckout() {
    if (!matched || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const result = latePickup
        ? await completeMobileLatePickup(matched.pass_id, latePickup.notes)
        : await completeMobilePickup(matched.pass_id);
      navigation.replace('PickupComplete', { result, latePickup: Boolean(latePickup) });
    } catch (checkoutError) {
      setError(checkoutError.message);
      setMatched(null);
      scanLock.current = false;
      setManualMode(true);
    } finally {
      setConfirming(false);
    }
  }

  function resetScanner() {
    setMatched(null);
    setError(null);
    setCode('');
    scanLock.current = false;
  }

  function reportUnauthorized() {
    const pickup = expectedPickup || (matched ? {
      child_id: matched.child_id,
      child_name: matched.child_name,
      primary_guardian_name: null,
      primary_guardian_phone: null,
    } : null);
    if (pickup) navigation.navigate('UnauthorizedPickup', { pickup });
  }

  const cameraDenied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Verify pickup</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {expectedPickup ? expectedPickup.child_name : 'Scan the family pickup pass'}
          </Text>
        </View>
      </View>

      {matched ? (
        <View style={styles.matchedPage}>
          <View style={styles.matchIcon}>
            <Ionicons name="shield-checkmark" size={44} color={colors.success} />
          </View>
          <Text style={styles.matchedEyebrow}>MATCHED</Text>
          <Text style={styles.matchedTitle}>{matched.presenter_name}</Text>
          <Text style={styles.matchedRelationship}>
            {matched.relationship || 'Authorized pickup'} · picking up {matched.child_name}
          </Text>

          {latePickup && (
            <View style={styles.lateSummary}>
              <Ionicons name="time-outline" size={20} color={colors.amber} />
              <View style={styles.lateSummaryCopy}>
                <Text style={styles.lateSummaryTitle}>Late-pickup record ready</Text>
                <Text style={styles.lateSummaryText}>
                  Confirming will check out {matched.child_name} and apply the center policy atomically.
                </Text>
              </View>
            </View>
          )}

          <View style={styles.authorizedCard}>
            <View style={styles.authorizedRow}>
              <View style={styles.authorizedIcon}>
                <Ionicons name="checkmark" size={17} color={colors.success} />
              </View>
              <View style={styles.authorizedCopy}>
                <Text style={styles.authorizedTitle}>Authorized</Text>
                <Text style={styles.authorizedText}>
                  The pass is current, unused, and matches the center pickup list.
                </Text>
              </View>
            </View>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.confirmButton, confirming && styles.disabled]}
            onPress={confirmCheckout}
            disabled={confirming}
            accessibilityRole="button"
          >
            {confirming
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.confirmButtonText}>
                {latePickup ? 'Confirm & log late pickup' : 'Confirm check-out'}
              </Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={resetScanner}>
            <Text style={styles.secondaryButtonText}>Scan a different pass</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.unauthorizedLink} onPress={reportUnauthorized}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={styles.unauthorizedLinkText}>Person isn’t on the list?</Text>
          </TouchableOpacity>
        </View>
      ) : manualMode ? (
        <View style={styles.manualPage}>
          <View style={styles.manualIcon}>
            <Ionicons name="keypad-outline" size={32} color={colors.primary} />
          </View>
          <Text style={styles.manualTitle}>Enter pass code</Text>
          <Text style={styles.manualText}>
            Ask the family for the 6-digit code shown below their QR pass.
          </Text>
          <TextInput
            style={[styles.codeInput, error && styles.codeInputError]}
            value={code}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, '').slice(0, 6));
              setError(null);
              scanLock.current = false;
            }}
            keyboardType="number-pad"
            placeholder="000000"
            placeholderTextColor={colors.textFaint}
            maxLength={6}
            autoFocus
            accessibilityLabel="Six digit pickup pass code"
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.confirmButton, (code.length !== 6 || verifying) && styles.disabled]}
            onPress={() => verify({ manualCode: code })}
            disabled={code.length !== 6 || verifying}
          >
            {verifying
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.confirmButtonText}>Verify code</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => { setManualMode(false); setError(null); scanLock.current = false; }}
          >
            <Text style={styles.secondaryButtonText}>Use camera instead</Text>
          </TouchableOpacity>
          {expectedPickup && (
            <TouchableOpacity style={styles.unauthorizedLink} onPress={reportUnauthorized}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.unauthorizedLinkText}>Person isn’t on the list?</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.scannerPage}>
          <View style={styles.cameraShell}>
            {permission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => verify({ token: data })}
              />
            ) : (
              <View style={styles.permissionCard}>
                <Ionicons name="camera-outline" size={40} color={colors.primary} />
                <Text style={styles.permissionTitle}>
                  {cameraDenied ? 'Camera access is off' : 'Camera access is needed'}
                </Text>
                <Text style={styles.permissionText}>
                  DailyLog uses the camera only to read the short-lived pickup QR code.
                </Text>
                <TouchableOpacity
                  style={styles.permissionButton}
                  onPress={cameraDenied ? () => Linking.openSettings() : requestPermission}
                >
                  <Text style={styles.permissionButtonText}>
                    {cameraDenied ? 'Open settings' : 'Allow camera'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {permission?.granted && (
              <View pointerEvents="none" style={styles.scanOverlay}>
                <View style={styles.scanFrame} />
                {verifying && (
                  <View style={styles.verifyingPill}>
                    <ActivityIndicator size="small" color={colors.white} />
                    <Text style={styles.verifyingText}>Checking pass…</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          <Text style={styles.scanInstruction}>Center the family’s QR code inside the frame.</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={styles.codeButton}
            onPress={() => { setManualMode(true); setError(null); scanLock.current = false; }}
          >
            <Ionicons name="keypad-outline" size={19} color={colors.primary} />
            <Text style={styles.codeButtonText}>Enter pass code instead</Text>
          </TouchableOpacity>
          {expectedPickup && (
            <TouchableOpacity style={styles.unauthorizedLink} onPress={reportUnauthorized}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.unauthorizedLinkText}>Person isn’t on the list?</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backButton: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: colors.primarySoft,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, fontFamily: fonts.black, color: colors.textPrimary },
  subtitle: { marginTop: 1, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textMuted },
  scannerPage: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  cameraShell: {
    flex: 1, minHeight: 320, overflow: 'hidden',
    borderRadius: 26, backgroundColor: '#10233E',
  },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: {
    width: 240, height: 240, borderWidth: 3, borderColor: colors.white,
    borderRadius: 22, backgroundColor: 'transparent',
  },
  verifyingPill: {
    position: 'absolute', bottom: spacing.xl, flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: 'rgba(18, 42, 72, 0.86)',
  },
  verifyingText: { color: colors.white, fontSize: 12.5, fontFamily: fonts.bold },
  permissionCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  permissionTitle: { marginTop: spacing.md, fontSize: 18, fontFamily: fonts.black, color: colors.white },
  permissionText: {
    marginTop: spacing.sm, maxWidth: 270, fontSize: 13, lineHeight: 19,
    textAlign: 'center', fontFamily: fonts.regular, color: '#C9D6E8',
  },
  permissionButton: {
    marginTop: spacing.lg, minHeight: 44, justifyContent: 'center',
    paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  permissionButtonText: { color: colors.white, fontSize: 14, fontFamily: fonts.bold },
  scanInstruction: {
    marginTop: spacing.md, textAlign: 'center', fontSize: 12.5,
    fontFamily: fonts.regular, color: colors.textMuted,
  },
  codeButton: {
    minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.md, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
  },
  codeButtonText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },
  errorText: {
    marginTop: spacing.md, paddingHorizontal: spacing.md, color: colors.danger,
    textAlign: 'center', fontSize: 12.5, lineHeight: 18, fontFamily: fonts.bold,
  },
  manualPage: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xxl, paddingTop: 54 },
  manualIcon: {
    width: 70, height: 70, alignItems: 'center', justifyContent: 'center',
    borderRadius: 35, backgroundColor: colors.primaryLight,
  },
  manualTitle: { marginTop: spacing.lg, fontSize: 24, fontFamily: fonts.black, color: colors.textPrimary },
  manualText: {
    marginTop: spacing.sm, maxWidth: 300, textAlign: 'center', fontSize: 13.5,
    lineHeight: 20, fontFamily: fonts.regular, color: colors.textMuted,
  },
  codeInput: {
    alignSelf: 'stretch', height: 70, marginTop: spacing.xl, paddingHorizontal: spacing.lg,
    borderWidth: 2, borderColor: colors.borderStrong, borderRadius: radius.lg,
    backgroundColor: colors.surface, color: colors.textPrimary, textAlign: 'center',
    fontSize: 29, letterSpacing: 10, fontFamily: fonts.black,
  },
  codeInputError: { borderColor: colors.danger },
  matchedPage: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: 45 },
  matchIcon: {
    width: 82, height: 82, alignItems: 'center', justifyContent: 'center',
    borderRadius: 41, backgroundColor: colors.successLight,
  },
  matchedEyebrow: {
    marginTop: spacing.lg, color: colors.success, fontSize: 11,
    letterSpacing: 1.6, fontFamily: fonts.bold,
  },
  matchedTitle: { marginTop: spacing.sm, fontSize: 26, fontFamily: fonts.black, color: colors.textPrimary },
  matchedRelationship: {
    marginTop: spacing.xs, textAlign: 'center', fontSize: 14,
    fontFamily: fonts.regular, color: colors.textMuted,
  },
  authorizedCard: {
    alignSelf: 'stretch', marginTop: spacing.xl, padding: spacing.lg,
    borderWidth: 1.5, borderColor: '#B6DFC9', borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  authorizedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  authorizedIcon: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
    borderRadius: 15, backgroundColor: colors.successLight,
  },
  authorizedCopy: { flex: 1 },
  authorizedTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.success },
  authorizedText: {
    marginTop: 2, fontSize: 12.5, lineHeight: 18,
    fontFamily: fonts.regular, color: colors.textMuted,
  },
  lateSummary: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    marginTop: spacing.md, padding: spacing.md, borderWidth: 1.5,
    borderColor: '#E9C98E', borderRadius: radius.lg, backgroundColor: colors.amberLight,
  },
  lateSummaryCopy: { flex: 1 },
  lateSummaryTitle: { color: colors.amber, fontSize: 13.5, fontFamily: fonts.bold },
  lateSummaryText: {
    marginTop: 2, color: colors.textMuted, fontSize: 11.5,
    lineHeight: 17, fontFamily: fonts.regular,
  },
  confirmButton: {
    alignSelf: 'stretch', minHeight: 54, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  confirmButtonText: { color: colors.white, fontSize: 16, fontFamily: fonts.bold },
  disabled: { opacity: 0.52 },
  secondaryButton: {
    alignSelf: 'stretch', minHeight: 50, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.sm, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },
  unauthorizedLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.lg, padding: spacing.sm,
  },
  unauthorizedLinkText: { color: colors.danger, fontSize: 13, fontFamily: fonts.bold },
});
