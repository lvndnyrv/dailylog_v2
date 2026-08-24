import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Button } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

export default function ParentDocumentSentScreen({ navigation, route }) {
  const request = route.params?.request;
  const child = route.params?.child;
  const fileName = route.params?.fileName;

  function returnToDocuments() {
    if (navigation.popTo) navigation.popTo('ParentDocuments', { childId: child?.id });
    else navigation.navigate('ParentDocuments', { childId: child?.id });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={40} color={colors.success} /></View>
        <View style={styles.headingWrap}>
          <Text style={styles.title}>Sent to the office</Text>
          <Text style={styles.subtitle}>Thanks! We received {child?.first_name || 'your child'}'s {request?.title?.toLowerCase() || 'document'}.</Text>
        </View>

        <View style={styles.fileCard}>
          <View style={styles.fileIcon}><Ionicons name="document-text-outline" size={22} color={colors.success} /></View>
          <View style={styles.flexOne}>
            <Text style={styles.fileTitle}>{request?.title || 'Family document'}</Text>
            <Text style={styles.fileMeta} numberOfLines={2}>{fileName || 'Uploaded just now'} · under review</Text>
          </View>
          <View style={styles.reviewBadge}><Text style={styles.reviewText}>Reviewing</Text></View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.infoText}>The request is cleared from your to-do while the office reviews it. If they need another copy, it will return to Documents with an explanation.</Text>
        </View>

        <View style={styles.spacer} />
        <Button label="Done" onPress={returnToDocuments} />
        <TouchableOpacity onPress={returnToDocuments} style={styles.backLink}>
          <Text style={styles.backText}>Back to Documents</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: 26, paddingTop: 42, paddingBottom: spacing.xl, alignItems: 'center', gap: spacing.lg },
  successIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  headingWrap: { alignItems: 'center', gap: spacing.sm },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 24 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center', paddingHorizontal: spacing.md },
  fileCard: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
  fileIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' },
  flexOne: { flex: 1, minWidth: 0 },
  fileTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  fileMeta: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  reviewBadge: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  reviewText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 10.5 },
  infoCard: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.lg },
  infoText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19 },
  spacer: { flex: 1 },
  backLink: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13.5 },
});
