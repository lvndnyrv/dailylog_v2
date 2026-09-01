import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { format } from 'date-fns';

import { ChildAvatar } from '../../components/ChildAvatar';
import { Button, Chip } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useIncidentForm } from '../../hooks/useIncidentReport';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const LOCATIONS = ['Classroom', 'Play area', 'Playground', 'Bathroom', 'Hallway', 'Gym', 'Nap room', 'Other'];
const INJURY_TYPES = ['Bump / bruise', 'Cut / scrape', 'Bite', 'Fall', 'Pinch / scratch', 'Head bump', 'Allergic reaction', 'Other'];
const BODY_PARTS = ['Forehead', 'Head', 'Face', 'Mouth / teeth', 'Neck', 'Arm', 'Hand', 'Torso', 'Back', 'Knee', 'Leg', 'Foot'];
const SEVERITIES = [
  { key: 'minor', label: 'Minor', color: colors.success, bg: colors.successLight },
  { key: 'moderate', label: 'Moderate', color: colors.amber, bg: colors.amberLight },
  { key: 'serious', label: 'Serious', color: colors.danger, bg: colors.dangerLight },
];

function displayName(person) {
  if (!person?.full_name) return 'Choose staff';
  const parts = person.full_name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

function initials(person) {
  return String(person?.full_name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function childName(child) {
  return [child?.first_name, child?.last_name].filter(Boolean).join(' ') || 'Child';
}

function FieldLabel({ children, optional }) {
  return (
    <Text style={styles.fieldLabel}>
      {children}
      {optional ? <Text style={styles.optional}> (optional)</Text> : null}
    </Text>
  );
}

function StaffPickerSheet({ visible, title, people, selectedId, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeCircle}>
              <Ionicons name="close" size={19} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.staffList}>
            {people.map((person, index) => {
              const selected = selectedId === person.id;
              return (
                <TouchableOpacity
                  key={person.id}
                  onPress={() => {
                    onSelect(person);
                    onClose();
                  }}
                  style={[styles.staffRow, index > 0 && styles.staffRowBorder]}
                  activeOpacity={0.72}
                >
                  <View style={styles.staffAvatar}>
                    <Text style={styles.staffAvatarText}>{initials(person)}</Text>
                  </View>
                  <View style={styles.staffCopy}>
                    <Text style={styles.staffName}>{person.full_name}</Text>
                    <Text style={styles.staffRole}>
                      {person.role === 'owner_admin' ? 'Owner admin' : person.role === 'admin' ? 'Administrator' : 'Educator'}
                    </Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={21} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function IncidentReportScreen({ route, navigation }) {
  const child = route.params?.child;
  const initialReportId = route.params?.reportId || null;
  const { profile } = useAuth();
  const {
    report,
    createDraft,
    updateReport,
    submitReport,
    uploadPhoto,
  } = useIncidentForm(initialReportId);

  const [stage, setStage] = useState('capture');
  const [reportId, setReportId] = useState(initialReportId);
  const [occurredAt, setOccurredAt] = useState(new Date());
  const [location, setLocation] = useState('');
  const [injuryType, setInjuryType] = useState('');
  const [injurySide, setInjurySide] = useState('front');
  const [bodyParts, setBodyParts] = useState([]);
  const [severity, setSeverity] = useState('minor');
  const [description, setDescription] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [firstAidGiven, setFirstAidGiven] = useState(true);
  const [firstAidBy, setFirstAidBy] = useState(profile || null);
  const [witness, setWitness] = useState(null);
  const [notes, setNotes] = useState('');
  const [photoUri, setPhotoUri] = useState(null);
  const [existingPhotoPaths, setExistingPhotoPaths] = useState([]);
  const [staff, setStaff] = useState([]);
  const [picker, setPicker] = useState(null);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(!initialReportId);

  function returnToIncidentHub() {
    const routes = navigation.getState()?.routes || [];
    if (routes.some(item => item.name === 'IncidentHub')) {
      navigation.popTo('IncidentHub');
      return;
    }
    navigation.navigate('IncidentHub');
  }

  useEffect(() => {
    if (!profile?.daycare_id) return;
    supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url')
      .eq('daycare_id', profile.daycare_id)
      .in('role', ['owner_admin', 'admin', 'educator'])
      .is('archived_at', null)
      .order('full_name')
      .then(({ data }) => setStaff(data || []));
  }, [profile?.daycare_id]);

  useEffect(() => {
    if (profile && !firstAidBy) setFirstAidBy(profile);
  }, [profile?.id]);

  useEffect(() => {
    if (!initialReportId || !report || hydrated) return;
    setOccurredAt(new Date(report.occurred_at));
    setLocation(report.location || '');
    setInjuryType(report.injury_type || '');
    setInjurySide(report.injury_side || 'front');
    setBodyParts(report.body_parts || []);
    setSeverity(report.severity || 'minor');
    setDescription(report.description || '');
    setActionTaken(report.first_aid_given || '');
    setFirstAidGiven(Boolean(report.first_aid_given));
    setNotes(report.notes || '');
    setExistingPhotoPaths(report.photo_paths || []);
    setFirstAidBy(staff.find(person => person.id === report.first_aid_by) || profile || null);
    setWitness(staff.find(person => person.id === report.witness_id) || null);
    setHydrated(true);
  }, [initialReportId, report, hydrated, staff, profile]);

  useEffect(() => {
    if (!report || !staff.length) return;
    if (report.witness_id && !witness) {
      setWitness(staff.find(person => person.id === report.witness_id) || null);
    }
    if (report.first_aid_by) {
      setFirstAidBy(staff.find(person => person.id === report.first_aid_by) || profile || null);
    }
  }, [staff, report?.witness_id, report?.first_aid_by]);

  const witnessOptions = useMemo(
    () => staff.filter(person => person.id !== profile?.id),
    [staff, profile?.id],
  );

  function toggleBodyPart(part) {
    setBodyParts(current => (
      current.includes(part)
        ? current.filter(item => item !== part)
        : [...current, part]
    ));
  }

  function validateForReview() {
    const missing = [];
    if (!location) missing.push('where it happened');
    if (!injuryType) missing.push('injury type');
    if (!bodyParts.length) missing.push('injury location');
    if (!description.trim()) missing.push('what happened');
    if (!actionTaken.trim()) missing.push('action taken');
    if (!witness) missing.push('staff witness');

    if (missing.length) {
      Alert.alert('Complete the report', `Please add: ${missing.join(', ')}.`);
      return false;
    }
    return true;
  }

  function draftPayload() {
    return {
      daycare_id: profile.daycare_id,
      child_id: child.id,
      educator_id: profile.id,
      classroom_id: child.classroom_id || profile.classroom_id,
      occurred_at: occurredAt.toISOString(),
      location: location || 'Classroom',
      severity,
      injury_type: injuryType || 'Incident',
      injury_side: injurySide,
      body_parts: bodyParts,
      description: description.trim(),
      first_aid_given: actionTaken.trim(),
      first_aid_by: firstAidGiven ? (firstAidBy?.id || profile.id) : null,
      witness_id: witness?.id || null,
      witnesses: witness ? [witness.full_name] : [],
      photo_paths: existingPhotoPaths,
      notes: notes.trim(),
      status: 'draft',
    };
  }

  async function persistDraft({ close = false } = {}) {
    if (!child?.id || !profile?.id || !profile?.daycare_id) {
      Alert.alert('Unable to save', 'Your child or center context is missing. Reopen the report and try again.');
      return null;
    }

    setSaving(true);
    const result = reportId
      ? await updateReport(reportId, draftPayload())
      : await createDraft(draftPayload());
    setSaving(false);

    if (result.error) {
      Alert.alert('Could not save draft', result.error.message);
      return null;
    }

    const id = reportId || result.data?.id;
    if (!reportId) setReportId(id);
    if (close) {
      Alert.alert(
        result.queued ? 'Draft saved for sync' : 'Draft saved',
        result.queued
          ? 'The report will sync automatically when this device reconnects.'
          : 'You can finish it from the incident hub.',
        [{ text: 'Done', onPress: returnToIncidentHub }],
      );
    }
    return id;
  }

  async function reviewReport() {
    if (!validateForReview()) return;
    const id = await persistDraft();
    if (id) setStage('review');
  }

  async function pickPhoto(source) {
    let result;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to attach an incident photo.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo permission needed', 'Allow photo access to attach an incident photo.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    }

    if (!result.canceled) {
      const resized = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
      );
      setPhotoUri(resized.uri);
    }
  }

  function choosePhoto() {
    Alert.alert('Attach a photo', 'Choose a source.', [
      { text: 'Take photo', onPress: () => pickPhoto('camera') },
      { text: 'Photo library', onPress: () => pickPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function submit() {
    if (!validateForReview()) {
      setStage('capture');
      return;
    }

    setSaving(true);
    let id = reportId;
    if (!id) {
      const result = await createDraft(draftPayload());
      if (result.error) {
        setSaving(false);
        Alert.alert('Could not save report', result.error.message);
        return;
      }
      id = result.data.id;
      setReportId(id);
    } else {
      const result = await updateReport(id, draftPayload());
      if (result.error) {
        setSaving(false);
        Alert.alert('Could not update report', result.error.message);
        return;
      }
    }

    let photoPaths = [...existingPhotoPaths];
    if (photoUri) {
      const uploaded = await uploadPhoto(id, child.id, photoUri);
      if (uploaded.error) {
        const proceed = await new Promise(resolve => {
          Alert.alert(
            'Photo could not upload',
            'Submit the incident without this photo? You can keep it as a draft and retry later.',
            [
              { text: 'Keep draft', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Submit without photo', onPress: () => resolve(true) },
            ],
          );
        });
        if (!proceed) {
          setSaving(false);
          return;
        }
      } else {
        photoPaths = [...photoPaths, uploaded.path];
        await updateReport(id, { photo_paths: photoPaths });
        setExistingPhotoPaths(photoPaths);
      }
    }

    const result = await submitReport(id, severity);
    setSaving(false);
    if (result.error) {
      Alert.alert('Could not submit report', result.error.message);
      return;
    }

    setStage('submitted');
  }

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading incident draft…</Text>
      </View>
    );
  }

  if (stage === 'submitted') {
    const isSerious = severity === 'serious';
    return (
      <View style={styles.container}>
        <View style={styles.submittedContent}>
          <View style={styles.successCircle}>
            <Ionicons name="checkmark" size={38} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>Report submitted</Text>
          <Text style={styles.successSub}>
            Sent to the director for sign-off.{' '}
            {isSerious
              ? `${child.first_name}'s parents were notified immediately.`
              : `${child.first_name}'s parents are notified the moment it is signed.`}
          </Text>

          <View style={styles.timelineCard}>
            <TimelineRow
              state="done"
              title="Submitted by you"
              subtitle={`${format(new Date(), 'h:mm a')} · witnessed by ${displayName(witness)}`}
            />
            <TimelineRow
              state="pending"
              title="Director sign-off"
              subtitle="Pending · available in the admin incident queue"
            />
            <TimelineRow
              state={isSerious ? 'done' : 'future'}
              title="Parents notified"
              subtitle={isSerious ? 'Sent immediately for this serious incident' : 'Family acknowledges in the parent app'}
              last
            />
          </View>

          <View style={styles.submittedSpacer} />
          <Button label="Back to incidents" onPress={returnToIncidentHub} style={styles.fullButton} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {stage === 'review' ? (
          <TouchableOpacity
            onPress={() => setStage('capture')}
            style={styles.headerCircle}
            accessibilityRole="button"
            accessibilityLabel="Back to incident details"
          >
            <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <Text style={styles.headerTitle}>{stage === 'review' ? 'Review report' : 'New incident'}</Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerCircle}
          accessibilityRole="button"
          accessibilityLabel="Close incident report"
        >
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {stage === 'review' ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.reviewCard}>
            <View style={styles.reviewHead}>
              <ChildAvatar child={child} size={42} />
              <View style={styles.reviewHeadCopy}>
                <Text style={styles.reviewName}>{childName(child)}</Text>
                <Text style={styles.reviewMeta}>
                  {format(occurredAt, 'h:mm a')} · {location}
                </Text>
              </View>
              <SeverityBadge severity={severity} />
            </View>
            <View style={styles.reviewBody}>
              <ReviewField label="INJURY" value={`${injuryType} · ${bodyParts.join(', ')} (${injurySide})`} />
              <ReviewField label="WHAT HAPPENED" value={description} />
              <ReviewField
                label="ACTION & FIRST AID"
                value={`${actionTaken}${firstAidGiven ? ` First aid by ${displayName(firstAidBy)}.` : ''}`}
              />
              <View style={styles.reviewPair}>
                <ReviewField label="WITNESS" value={displayName(witness)} compact />
                <ReviewField
                  label="PHOTO"
                  value={photoUri || existingPhotoPaths.length ? '1 attached' : 'None'}
                  compact
                />
              </View>
            </View>
          </View>

          <View style={styles.noticeCard}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
            <Text style={styles.noticeText}>
              By submitting, you confirm this is accurate. It is sent to the director to sign off
              and locks once signed.
            </Text>
          </View>

          <Button label="Submit for sign-off" onPress={submit} loading={saving} />
          <TouchableOpacity
            onPress={() => persistDraft({ close: true })}
            disabled={saving}
            style={styles.saveDraftLink}
          >
            <Text style={styles.saveDraftText}>Save as draft</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          enableOnAndroid
          extraScrollHeight={36}
          keyboardShouldPersistTaps="handled"
        >
          <FieldLabel>CHILD</FieldLabel>
          <View style={styles.selectRow}>
            <ChildAvatar child={child} size={36} />
            <Text style={styles.selectValue}>{childName(child)}</Text>
          </View>

          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <FieldLabel>TIME</FieldLabel>
              <View style={styles.compactField}>
                <Text style={styles.compactText}>Now · {format(occurredAt, 'h:mm a')}</Text>
              </View>
            </View>
            <View style={styles.column}>
              <FieldLabel>WHERE</FieldLabel>
              <TouchableOpacity
                style={styles.compactField}
                onPress={() => setPicker('location')}
              >
                <Text style={[styles.compactText, !location && styles.placeholder]}>
                  {location || 'Choose'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            </View>
          </View>

          <FieldLabel>INJURY TYPE</FieldLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalChips}>
            {INJURY_TYPES.map(item => (
              <Chip key={item} label={item} selected={injuryType === item} onPress={() => setInjuryType(item)} />
            ))}
          </ScrollView>

          <FieldLabel>INJURY LOCATION</FieldLabel>
          <View style={styles.bodyMapCard}>
            <View style={styles.bodyFigure}>
              <Ionicons name="body-outline" size={62} color={colors.primary} />
              <Text style={styles.bodyFigureText}>Tap a body area</Text>
            </View>
            <View style={styles.bodyControls}>
              <View style={styles.segmented}>
                {['front', 'back'].map(side => (
                  <TouchableOpacity
                    key={side}
                    onPress={() => setInjurySide(side)}
                    style={[styles.segment, injurySide === side && styles.segmentSelected]}
                  >
                    <Text style={[styles.segmentText, injurySide === side && styles.segmentTextSelected]}>
                      {side[0].toUpperCase() + side.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.bodyChips}>
                {BODY_PARTS.map(part => (
                  <TouchableOpacity
                    key={part}
                    onPress={() => toggleBodyPart(part)}
                    style={[styles.bodyChip, bodyParts.includes(part) && styles.bodyChipSelected]}
                  >
                    <Text style={[styles.bodyChipText, bodyParts.includes(part) && styles.bodyChipTextSelected]}>
                      {part}{bodyParts.includes(part) ? ' ✓' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <FieldLabel>SEVERITY</FieldLabel>
          <View style={styles.severityRow}>
            {SEVERITIES.map(item => (
              <TouchableOpacity
                key={item.key}
                onPress={() => setSeverity(item.key)}
                style={[
                  styles.severityOption,
                  severity === item.key && { backgroundColor: item.bg, borderColor: item.color },
                ]}
              >
                <Text style={[
                  styles.severityOptionText,
                  severity === item.key && { color: item.color },
                ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <FieldLabel>WHAT HAPPENED</FieldLabel>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened, including what the child was doing."
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.textArea}
          />

          <FieldLabel>ACTION & FIRST AID</FieldLabel>
          <TextInput
            value={actionTaken}
            onChangeText={setActionTaken}
            placeholder="What care, comfort, or monitoring was provided?"
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.textArea}
          />
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setFirstAidGiven(value => !value)}
            activeOpacity={0.75}
          >
            <Text style={styles.toggleLabel}>First aid given</Text>
            <View style={[styles.toggle, firstAidGiven && styles.toggleOn]}>
              <View style={[styles.toggleKnob, firstAidGiven && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>

          {firstAidGiven && (
            <TouchableOpacity style={styles.selectRow} onPress={() => setPicker('firstAid')}>
              <Text style={styles.selectLabel}>Administered by</Text>
              <View style={styles.staffSelected}>
                <View style={styles.miniAvatar}>
                  <Text style={styles.miniAvatarText}>{initials(firstAidBy)}</Text>
                </View>
                <Text style={styles.staffSelectedText}>{displayName(firstAidBy)}</Text>
                <Ionicons name="chevron-down" size={15} color={colors.textFaint} />
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.selectRow} onPress={() => setPicker('witness')}>
            <Text style={styles.selectLabel}>
              Witness <Text style={styles.optional}>(required)</Text>
            </Text>
            <View style={styles.staffSelected}>
              {witness && (
                <View style={styles.miniAvatar}>
                  <Text style={styles.miniAvatarText}>{initials(witness)}</Text>
                </View>
              )}
              <Text style={[styles.staffSelectedText, !witness && styles.placeholder]}>
                {displayName(witness)}
              </Text>
              <Ionicons name="chevron-down" size={15} color={colors.textFaint} />
            </View>
          </TouchableOpacity>

          <FieldLabel optional>PHOTO</FieldLabel>
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photo} />
              <TouchableOpacity style={styles.removePhoto} onPress={() => setPhotoUri(null)}>
                <Ionicons name="close" size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.photoButton} onPress={choosePhoto}>
              <Ionicons name="camera-outline" size={23} color={colors.primary} />
              <Text style={styles.photoButtonText}>
                {existingPhotoPaths.length ? 'Photo attached · Replace' : 'Add injury photo'}
              </Text>
            </TouchableOpacity>
          )}

          <FieldLabel optional>INTERNAL NOTES</FieldLabel>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes for the director (not shown in the summary)."
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.textArea}
          />

          <View style={[
            styles.parentNotice,
            severity === 'serious' && styles.parentNoticeUrgent,
          ]}>
            <Ionicons
              name={severity === 'serious' ? 'alert-circle-outline' : 'information-circle-outline'}
              size={19}
              color={severity === 'serious' ? colors.danger : colors.primary}
            />
            <Text style={styles.parentNoticeText}>
              {severity === 'serious'
                ? `${child.first_name}'s parents and the director are notified immediately on submission.`
                : `${child.first_name}'s parents are notified once the director signs off. Serious incidents notify them immediately.`}
            </Text>
          </View>

          <Button label="Review & submit" onPress={reviewReport} loading={saving} />
          <TouchableOpacity
            onPress={() => persistDraft({ close: true })}
            disabled={saving}
            style={styles.saveDraftLink}
          >
            <Text style={styles.saveDraftText}>Save as draft</Text>
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      )}

      <Modal
        visible={picker === 'location'}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker(null)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={() => setPicker(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Where did it happen?</Text>
              <TouchableOpacity onPress={() => setPicker(null)} style={styles.closeCircle}>
                <Ionicons name="close" size={19} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.locationGrid}>
              {LOCATIONS.map(item => (
                <TouchableOpacity
                  key={item}
                  onPress={() => {
                    setLocation(item);
                    setPicker(null);
                  }}
                  style={[styles.locationOption, location === item && styles.locationOptionSelected]}
                >
                  <Text style={[styles.locationText, location === item && styles.locationTextSelected]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <StaffPickerSheet
        visible={picker === 'witness'}
        title="Choose a witness"
        people={witnessOptions}
        selectedId={witness?.id}
        onSelect={setWitness}
        onClose={() => setPicker(null)}
      />
      <StaffPickerSheet
        visible={picker === 'firstAid'}
        title="Who gave first aid?"
        people={staff}
        selectedId={firstAidBy?.id}
        onSelect={setFirstAidBy}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function SeverityBadge({ severity }) {
  const item = SEVERITIES.find(option => option.key === severity) || SEVERITIES[0];
  return (
    <View style={[styles.reviewSeverity, { backgroundColor: item.bg }]}>
      <Text style={[styles.reviewSeverityText, { color: item.color }]}>{item.label}</Text>
    </View>
  );
}

function ReviewField({ label, value, compact }) {
  return (
    <View style={compact ? styles.reviewCompact : null}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

function TimelineRow({ state, title, subtitle, last }) {
  const done = state === 'done';
  const pending = state === 'pending';
  const color = done ? colors.success : pending ? colors.amber : colors.borderStrong;
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={[
          styles.timelineDot,
          done && { backgroundColor: colors.successLight },
          pending && { backgroundColor: colors.amberLight },
        ]}>
          {done
            ? <Ionicons name="checkmark" size={13} color={color} />
            : pending
              ? <View style={[styles.timelineInnerDot, { backgroundColor: color }]} />
              : null}
        </View>
        {!last && <View style={styles.timelineLine} />}
      </View>
      <View style={styles.timelineCopy}>
        <Text style={styles.timelineTitle}>{title}</Text>
        <Text style={[styles.timelineSub, pending && { color: colors.amber }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  loadingText: { fontSize: 14, fontFamily: fonts.bold, color: colors.textMuted },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 21, fontFamily: fonts.black, color: colors.textPrimary },
  headerCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 34 },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: 38 },
  fieldLabel: {
    fontSize: 11.5,
    letterSpacing: 0.65,
    fontFamily: fonts.bold,
    color: colors.textFaint,
    marginTop: spacing.md,
    marginBottom: 7,
  },
  optional: {
    letterSpacing: 0,
    textTransform: 'none',
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  selectRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: { flex: 1, fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  selectLabel: { flex: 1, fontSize: 14, fontFamily: fonts.regular, color: colors.textPrimary },
  twoColumns: { flexDirection: 'row', gap: spacing.md },
  column: { flex: 1 },
  compactField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  compactText: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
  placeholder: { color: colors.textFaint },
  horizontalChips: { marginRight: -spacing.xxl },
  bodyMapCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  bodyFigure: {
    width: 82,
    minHeight: 142,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  bodyFigureText: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  bodyControls: { flex: 1 },
  segmented: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.full,
    padding: 3,
    marginBottom: spacing.sm,
  },
  segment: { borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 5 },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.textMuted },
  segmentTextSelected: { color: colors.white },
  bodyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  bodyChip: {
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  bodyChipSelected: { backgroundColor: colors.primary },
  bodyChipText: { fontSize: 10.5, fontFamily: fonts.bold, color: colors.textSecondary },
  bodyChipTextSelected: { color: colors.white },
  severityRow: { flexDirection: 'row', gap: spacing.sm },
  severityOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  severityOptionText: { fontSize: 13, fontFamily: fonts.bold, color: colors.textMuted },
  textArea: {
    minHeight: 76,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlignVertical: 'top',
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  toggleRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  toggleLabel: { fontSize: 14, fontFamily: fonts.regular, color: colors.textPrimary },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    padding: 3,
  },
  toggleOn: { backgroundColor: colors.primary },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.white },
  toggleKnobOn: { alignSelf: 'flex-end' },
  staffSelected: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  staffSelectedText: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
  miniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: { fontSize: 10, fontFamily: fonts.bold, color: colors.primary },
  photoButton: {
    minHeight: 74,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  photoButtonText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.primary },
  photoWrap: { height: 116, borderRadius: radius.lg, overflow: 'hidden' },
  photo: { width: '100%', height: '100%', resizeMode: 'cover' },
  removePhoto: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(20,40,65,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginVertical: spacing.lg,
  },
  parentNoticeUrgent: { backgroundColor: colors.dangerLight },
  parentNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  saveDraftLink: { alignItems: 'center', paddingVertical: spacing.lg },
  saveDraftText: { fontSize: 14, fontFamily: fonts.bold, color: colors.textMuted },
  reviewCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.xl,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  reviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  reviewHeadCopy: { flex: 1 },
  reviewName: { fontSize: 15, fontFamily: fonts.black, color: colors.textPrimary },
  reviewMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint, marginTop: 2 },
  reviewSeverity: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  reviewSeverityText: { fontSize: 11, fontFamily: fonts.bold },
  reviewBody: { gap: spacing.md, padding: spacing.lg },
  reviewLabel: {
    fontSize: 10.5,
    letterSpacing: 0.6,
    fontFamily: fonts.bold,
    color: colors.textFaint,
    marginBottom: 4,
  },
  reviewValue: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.regular, color: colors.textPrimary },
  reviewPair: { flexDirection: 'row', gap: spacing.xxl },
  reviewCompact: { flex: 1 },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginVertical: spacing.lg,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  submittedContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingTop: 72,
    paddingBottom: 38,
  },
  successCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 22, fontFamily: fonts.black, color: colors.textPrimary, marginTop: spacing.lg },
  successSub: {
    textAlign: 'center',
    fontSize: 13.5,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  timelineCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xs,
    marginTop: spacing.xxl,
  },
  timelineRow: { flexDirection: 'row', gap: spacing.md, minHeight: 70 },
  timelineRail: { alignItems: 'center' },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineInnerDot: { width: 8, height: 8, borderRadius: 4 },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  timelineCopy: { flex: 1, paddingTop: 3 },
  timelineTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  timelineSub: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    marginTop: 3,
  },
  submittedSpacer: { flex: 1 },
  fullButton: { alignSelf: 'stretch' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,40,70,0.42)' },
  sheetDismiss: { flex: 1 },
  sheet: {
    maxHeight: '68%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 38,
  },
  sheetGrabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 20, fontFamily: fonts.black, color: colors.textPrimary },
  closeCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffList: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  staffRowBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  staffAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffAvatarText: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  staffCopy: { flex: 1 },
  staffName: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  staffRole: { fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted, marginTop: 2 },
  locationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  locationOption: {
    width: '48%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  locationOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  locationText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.textSecondary },
  locationTextSelected: { color: colors.primary },
});
