import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, TextInput, Image, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useAuth } from '../../hooks/useAuth';
import { useIncidentForm } from '../../hooks/useIncidentReport';
import { notifyIncident } from '../../hooks/usePushNotifications';
import { Chip, Button } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { colors, spacing, radius } from '../../theme';
import { format } from 'date-fns';

const LOCATIONS = [
  { label: 'Classroom', emoji: '🏫' },
  { label: 'Playground', emoji: '🛝' },
  { label: 'Bathroom', emoji: '🚻' },
  { label: 'Hallway', emoji: '🚪' },
  { label: 'Gym', emoji: '🏋️' },
  { label: 'Kitchen', emoji: '🍽️' },
  { label: 'Nap room', emoji: '🛏️' },
  { label: 'Other', emoji: '📍' },
];

const INJURY_TYPES = [
  { label: 'Bump / bruise', emoji: '🟣' },
  { label: 'Cut / scrape', emoji: '🩹' },
  { label: 'Bite', emoji: '😬' },
  { label: 'Fall', emoji: '⬇️' },
  { label: 'Pinch / scratch', emoji: '✋' },
  { label: 'Head bump', emoji: '🤕' },
  { label: 'Allergic reaction', emoji: '🤧' },
  { label: 'Other', emoji: '❓' },
];

const BODY_PARTS = [
  'Head', 'Face', 'Neck', 'Arm (L)', 'Arm (R)',
  'Hand (L)', 'Hand (R)', 'Torso', 'Back',
  'Leg (L)', 'Leg (R)', 'Knee (L)', 'Knee (R)',
  'Foot (L)', 'Foot (R)', 'Finger', 'Mouth / teeth',
];

const SEVERITY_OPTIONS = [
  { key: 'minor', label: 'Minor', desc: 'Small bump, no lasting mark', color: colors.amber, bg: colors.amberLight },
  { key: 'moderate', label: 'Moderate', desc: 'Visible mark, some first aid', color: colors.coral, bg: colors.coralLight },
  { key: 'serious', label: 'Serious', desc: 'Needs medical attention', color: colors.danger, bg: colors.dangerLight },
];

const FIRST_AID_OPTIONS = [
  'Ice pack applied', 'Wound cleaned', 'Bandage applied',
  'Comfort given', 'Monitored for symptoms', 'None needed',
];

export default function IncidentReportScreen({ route, navigation }) {
  const { child } = route.params;
  const { profile } = useAuth();
  const { createDraft, updateReport, submitReport, uploadPhoto } = useIncidentForm();

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [reportId, setReportId] = useState(null);

  // Step 1 state
  const [occurredAt] = useState(new Date());
  const [location, setLocation] = useState('');
  const [severity, setSeverity] = useState('minor');
  const [injuryType, setInjuryType] = useState('');
  const [bodyParts, setBodyParts] = useState([]);
  const [description, setDescription] = useState('');

  // Step 2 state
  const [firstAid, setFirstAid] = useState('');
  const [firstAidChecks, setFirstAidChecks] = useState([]);
  const [witnesses, setWitnesses] = useState('');
  const [photos, setPhotos] = useState([]); // array of local URIs
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [notes, setNotes] = useState('');

  function toggleBodyPart(part) {
    setBodyParts(prev =>
      prev.includes(part) ? prev.filter(p => p !== part) : [...prev, part]
    );
  }

  function toggleFirstAidCheck(item) {
    setFirstAidChecks(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    );
  }

  async function handlePickPhoto() {
    Alert.alert('Add photo', 'Choose a source', [
      { text: 'Camera', onPress: () => capturePhoto('camera') },
      { text: 'Photo library', onPress: () => capturePhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function capturePhoto(source) {
    let result;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
    }

    if (!result.canceled) {
      const manipResult = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1000 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhotos(prev => [...prev, manipResult.uri]);
    }
  }

  function removePhoto(index) {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }

  // Save draft and advance to next step
  async function handleNext() {
    if (step === 1) {
      if (!location) {
        Alert.alert('Required', 'Please select where the incident occurred.');
        return;
      }
      if (!injuryType) {
        Alert.alert('Required', 'Please select the type of injury.');
        return;
      }
      if (bodyParts.length === 0) {
        Alert.alert('Required', 'Please select the affected body part(s).');
        return;
      }

      // Create draft on first next
      if (!reportId) {
        setSaving(true);
        const { data, error } = await createDraft({
          child_id: child.id,
          educator_id: profile.id,
          classroom_id: profile.classroom_id,
          occurred_at: occurredAt.toISOString(),
          location,
          severity,
          injury_type: injuryType,
          body_parts: bodyParts,
          description,
          status: 'draft',
        });
        setSaving(false);
        if (error) {
          Alert.alert('Error', error.message);
          return;
        }
        setReportId(data.id);
      } else {
        // Update existing draft
        await updateReport(reportId, {
          location,
          severity,
          injury_type: injuryType,
          body_parts: bodyParts,
          description,
        });
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }

  async function handleSubmit() {
    setSaving(true);

    // Upload photos — a failure (e.g. offline on the playground) must not
    // block the incident report itself
    const uploadedPaths = [];
    let photoFailure = null;
    for (const uri of photos) {
      const { path, error } = await uploadPhoto(reportId, child.id, uri);
      if (error) { photoFailure = error; break; }
      uploadedPaths.push(path);
    }

    if (photoFailure) {
      const proceed = await new Promise(resolve => {
        Alert.alert(
          'Photo upload failed',
          `${photoFailure.message || 'Network error'}\n\nSubmit the report without the remaining photos? You can add photos later.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Submit without photos', onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) {
        setSaving(false);
        return;
      }
    }

    // Combine first aid text
    const combinedFirstAid = [
      ...firstAidChecks,
      ...(firstAid.trim() ? [firstAid.trim()] : []),
    ].join('. ');

    // Final update with all step 2 data
    await updateReport(reportId, {
      first_aid_given: combinedFirstAid,
      witnesses: witnesses.trim() ? witnesses.split(',').map(w => w.trim()) : [],
      photo_paths: uploadedPaths,
      notes,
    });

    // Submit and notify
    const { error, queued } = await submitReport(reportId);
    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // Send push notification to parents (skipped when offline — the queued
    // report syncs on reconnect, but pushes need a live connection)
    if (!queued) {
      try {
        await notifyIncident(child.id, child.first_name, severity);
      } catch (e) {
        // Non-blocking: notification failure shouldn't block the form
        console.warn('Push notification failed:', e);
      }
    }

    Alert.alert(
      queued ? 'Report saved — will submit when online' : 'Report submitted ✓',
      queued
        ? `You're offline. ${child.first_name}'s incident report is saved and will be submitted automatically when you reconnect. Notify parents in person or by phone in the meantime.`
        : `The incident report for ${child.first_name} has been submitted and parents have been notified.`,
      [{ text: 'Done', onPress: () => navigation.goBack() }]
    );
  }

  // ─── STEP 1: WHAT HAPPENED ───────────────────────────────────────────────
  function renderStep1() {
    return (
      <>
        {/* Timestamp */}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>When</Text>
          <Text style={styles.infoValue}>
            {format(occurredAt, 'h:mm a')} · {format(occurredAt, 'MMM d, yyyy')}
          </Text>
        </View>

        {/* Severity */}
        <Text style={styles.sectionLabel}>Severity</Text>
        <View style={styles.severityRow}>
          {SEVERITY_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setSeverity(opt.key)}
              style={[
                styles.severityCard,
                { borderColor: severity === opt.key ? opt.color : colors.border },
                severity === opt.key && { backgroundColor: opt.bg },
              ]}
              activeOpacity={0.7}
            >
              <View style={[styles.severityDot, { backgroundColor: opt.color }]} />
              <Text style={[styles.severityLabel, severity === opt.key && { color: opt.color }]}>
                {opt.label}
              </Text>
              <Text style={styles.severityDesc}>{opt.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Location */}
        <Text style={styles.sectionLabel}>Where did it happen?</Text>
        <View style={styles.chipGrid}>
          {LOCATIONS.map(loc => (
            <Chip
              key={loc.label}
              label={`${loc.emoji} ${loc.label}`}
              selected={location === loc.label}
              onPress={() => setLocation(loc.label)}
            />
          ))}
        </View>

        {/* Injury type */}
        <Text style={styles.sectionLabel}>Type of injury</Text>
        <View style={styles.chipGrid}>
          {INJURY_TYPES.map(type => (
            <Chip
              key={type.label}
              label={`${type.emoji} ${type.label}`}
              selected={injuryType === type.label}
              onPress={() => setInjuryType(type.label)}
            />
          ))}
        </View>

        {/* Body parts */}
        <Text style={styles.sectionLabel}>Affected body part(s)</Text>
        <View style={styles.chipGrid}>
          {BODY_PARTS.map(part => (
            <Chip
              key={part}
              label={part}
              selected={bodyParts.includes(part)}
              onPress={() => toggleBodyPart(part)}
              color={colors.coral}
              lightColor={colors.coralLight}
            />
          ))}
        </View>

        {/* Description */}
        <Text style={styles.sectionLabel}>What happened?</Text>
        <TextInput
          style={styles.textArea}
          value={description}
          onChangeText={setDescription}
          placeholder="Briefly describe what happened..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </>
    );
  }

  // ─── STEP 2: FIRST AID & DETAILS ─────────────────────────────────────────
  function renderStep2() {
    return (
      <>
        {/* First aid checklist */}
        <Text style={styles.sectionLabel}>First aid provided</Text>
        <View style={styles.chipGrid}>
          {FIRST_AID_OPTIONS.map(item => (
            <Chip
              key={item}
              label={item}
              selected={firstAidChecks.includes(item)}
              onPress={() => toggleFirstAidCheck(item)}
              color={colors.success}
              lightColor={colors.successLight}
            />
          ))}
        </View>

        <TextInput
          style={styles.textArea}
          value={firstAid}
          onChangeText={setFirstAid}
          placeholder="Additional first aid details (optional)..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        {/* Photos */}
        <Text style={styles.sectionLabel}>Photos (optional)</Text>
        <Text style={styles.hint}>Adding a photo helps parents understand the situation</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
          {photos.map((uri, index) => (
            <View key={index} style={styles.photoThumb}>
              <Image source={{ uri }} style={styles.photoImage} />
              <TouchableOpacity style={styles.photoRemove} onPress={() => removePhoto(index)}>
                <Text style={styles.photoRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < 3 && (
            <TouchableOpacity style={styles.photoAdd} onPress={handlePickPhoto}>
              {uploadingPhoto
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={styles.photoAddText}>+ Photo</Text>
              }
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Witnesses */}
        <Text style={styles.sectionLabel}>Witnesses</Text>
        <TextInput
          style={styles.input}
          value={witnesses}
          onChangeText={setWitnesses}
          placeholder="Names of others who saw it (comma-separated)"
          placeholderTextColor={colors.textMuted}
        />

        {/* Notes */}
        <Text style={styles.sectionLabel}>Additional notes</Text>
        <TextInput
          style={styles.textArea}
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything else parents should know..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </>
    );
  }

  // ─── STEP 3: REVIEW ──────────────────────────────────────────────────────
  function renderStep3() {
    const sevOption = SEVERITY_OPTIONS.find(s => s.key === severity);
    const combinedFirstAid = [
      ...firstAidChecks,
      ...(firstAid.trim() ? [firstAid.trim()] : []),
    ].join('. ') || 'None documented';

    return (
      <>
        <View style={styles.reviewCard}>
          <Text style={styles.reviewTitle}>📋 Incident Summary</Text>

          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Child</Text>
            <Text style={styles.reviewValue}>{child.first_name} {child.last_name}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>When</Text>
            <Text style={styles.reviewValue}>{format(occurredAt, 'h:mm a · MMM d, yyyy')}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Severity</Text>
            <View style={[styles.severityBadge, { backgroundColor: sevOption.bg }]}>
              <View style={[styles.severityDotSmall, { backgroundColor: sevOption.color }]} />
              <Text style={[styles.severityBadgeText, { color: sevOption.color }]}>{sevOption.label}</Text>
            </View>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Location</Text>
            <Text style={styles.reviewValue}>{location}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Injury type</Text>
            <Text style={styles.reviewValue}>{injuryType}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Body parts</Text>
            <Text style={styles.reviewValue}>{bodyParts.join(', ')}</Text>
          </View>
          {description ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Description</Text>
              <Text style={styles.reviewValue}>{description}</Text>
            </View>
          ) : null}
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>First aid</Text>
            <Text style={styles.reviewValue}>{combinedFirstAid}</Text>
          </View>
          {witnesses.trim() ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Witnesses</Text>
              <Text style={styles.reviewValue}>{witnesses}</Text>
            </View>
          ) : null}
          {photos.length > 0 && (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Photos</Text>
              <Text style={styles.reviewValue}>{photos.length} attached</Text>
            </View>
          )}
          {notes.trim() ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Notes</Text>
              <Text style={styles.reviewValue}>{notes}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>
            ⚠️ Submitting will immediately notify {child.first_name}'s parents with a push notification. They'll be asked to acknowledge this report.
          </Text>
        </View>
      </>
    );
  }

  // ─── MAIN RENDER ──────────────────────────────────────────────────────────
  const stepTitles = ['What happened', 'First aid & details', 'Review & submit'];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (step > 1) setStep(step - 1);
          else navigation.goBack();
        }}>
          <Text style={styles.back}>{step > 1 ? '← Back' : '✕ Cancel'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Incident report</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Child info bar */}
      <View style={styles.childBar}>
        <ChildAvatar child={child} size={36} />
        <View>
          <Text style={styles.childName}>{child.first_name} {child.last_name}</Text>
          <Text style={styles.childDate}>{format(occurredAt, 'EEEE, MMMM d, yyyy')}</Text>
        </View>
      </View>

      {/* Progress steps */}
      <View style={styles.progress}>
        {[1, 2, 3].map(s => (
          <View key={s} style={styles.progressStep}>
            <View style={[styles.progressDot, s <= step && styles.progressDotActive]} />
            <Text style={[styles.progressLabel, s === step && styles.progressLabelActive]}>
              {stepTitles[s - 1]}
            </Text>
          </View>
        ))}
      </View>

      {/* Step content */}
      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>

      {/* Bottom action */}
      <View style={styles.footer}>
        {step < 3 ? (
          <Button
            label={saving ? 'Saving...' : 'Next →'}
            onPress={handleNext}
            loading={saving}
          />
        ) : (
          <Button
            label={saving ? 'Submitting...' : '⚠️ Submit & Notify Parents'}
            onPress={handleSubmit}
            loading={saving}
            style={{ backgroundColor: colors.danger }}
          />
        )}
      </View>
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl + spacing.md, paddingBottom: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 80 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },

  childBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  childName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  childDate: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  progress: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  progressStep: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  progressDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border,
  },
  progressDotActive: { backgroundColor: colors.primary },
  progressLabel: { fontSize: 12, color: colors.textMuted },
  progressLabelActive: { color: colors.primary, fontWeight: '600' },

  scrollBody: { flex: 1 },
  scrollContent: { padding: spacing.xl },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.lg, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  infoLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  infoValue: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },

  sectionLabel: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary,
    marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },

  severityRow: { flexDirection: 'row', gap: spacing.sm },
  severityCard: {
    flex: 1, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', gap: spacing.xs,
  },
  severityDot: { width: 10, height: 10, borderRadius: 5 },
  severityLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  severityDesc: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap' },

  textArea: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, fontSize: 14, color: colors.textPrimary,
    minHeight: 100, marginTop: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, fontSize: 14, color: colors.textPrimary,
  },

  photoRow: { marginTop: spacing.sm, marginBottom: spacing.md },
  photoThumb: { width: 80, height: 80, borderRadius: radius.md, marginRight: spacing.sm, position: 'relative' },
  photoImage: { width: 80, height: 80, borderRadius: radius.md },
  photoRemove: {
    position: 'absolute', top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  photoRemoveText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  photoAdd: {
    width: 80, height: 80, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  photoAddText: { fontSize: 13, color: colors.primary, fontWeight: '500' },

  reviewCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  reviewTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  reviewRow: {
    flexDirection: 'row', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border + '66',
  },
  reviewLabel: { width: 100, fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  reviewValue: { flex: 1, fontSize: 14, color: colors.textPrimary },
  severityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  severityDotSmall: { width: 6, height: 6, borderRadius: 3 },
  severityBadgeText: { fontSize: 13, fontWeight: '600' },

  noticeCard: {
    backgroundColor: colors.amberLight, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginTop: spacing.lg,
  },
  noticeText: { fontSize: 13, color: colors.textPrimary, lineHeight: 19 },

  footer: {
    padding: spacing.xl, paddingBottom: spacing.xxl,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
});


