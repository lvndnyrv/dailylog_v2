import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, Linking, ActivityIndicator, Modal, ScrollView
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
 import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { useClassroom } from '../../hooks/useClassroom';
import { Input, Button, Divider } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { DatePickerField } from '../../components/DatePickerField';
import { colors, spacing, radius } from '../../theme';
import { format } from 'date-fns';

export default function ChildProfileScreen({ route, navigation }) {
  const { child } = route.params;
  const { classrooms, active: activeClassroom } = useClassroom();

  const [firstName, setFirstName] = useState(child.first_name || '');
  const [lastName, setLastName]   = useState(child.last_name  || '');
  const [dob, setDob]             = useState(child.date_of_birth || '');
  const [photoUrl, setPhotoUrl]   = useState(child.photo_url || null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [removing, setRemoving]   = useState(false);
  const [movingClass, setMovingClass] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [currentClassroomId, setCurrentClassroomId] = useState(child.classroom_id);

  // Linked parents
  const [parents, setParents]         = useState([]);
  const [loadingParents, setLoadingParents] = useState(true);

  // Invite new parent
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting]       = useState(false);

  // Incidents history
  const [incidents, setIncidents] = useState([]);

  const hasChanges =
    firstName.trim() !== (child.first_name   || '') ||
    lastName.trim()  !== (child.last_name    || '') ||
    dob              !== (child.date_of_birth || '');

  useEffect(() => {
    loadParents();
    loadIncidents();
  }, []);

  // ─── PROFILE PHOTO ────────────────────────────────────────────────────────
  function handleChangePhoto() {
    Alert.alert('Profile photo', 'Choose a source', [
      { text: 'Camera', onPress: () => pickPhoto('camera') },
      { text: 'Photo library', onPress: () => pickPhoto('library') },
      ...(photoUrl ? [{ text: 'Remove photo', style: 'destructive', onPress: handleRemovePhoto }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickPhoto(source) {
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled) await uploadAvatar(result.assets[0].uri);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled) await uploadAvatar(result.assets[0].uri);
    }
  }

  async function uploadAvatar(uri) {
    setUploadingPhoto(true);
    try {
      // Resize to 400x400 for profile photos
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 400, height: 400 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      const response = await fetch(manipResult.uri);
      const blob = await response.blob();
      const path = `${child.id}/avatar_${Date.now()}.jpg`;

      // Remove old avatar if exists
      if (photoUrl) {
        await supabase.storage.from('child-avatars').remove([photoUrl]);
      }

      // Upload new avatar
      const { error: uploadError } = await supabase.storage
        .from('child-avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      // Update child record
      const { error: dbError } = await supabase
        .from('children')
        .update({ photo_url: path })
        .eq('id', child.id);

      if (dbError) throw dbError;

      setPhotoUrl(path);
      Alert.alert('Photo updated ✓', `${firstName}'s profile photo has been set.`);
    } catch (err) {
      Alert.alert('Upload failed', err.message);
    }
    setUploadingPhoto(false);
  }

  async function handleRemovePhoto() {
    try {
      if (photoUrl) {
        await supabase.storage.from('child-avatars').remove([photoUrl]);
      }
      await supabase.from('children').update({ photo_url: null }).eq('id', child.id);
      setPhotoUrl(null);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function loadParents() {
    setLoadingParents(true);
    const { data } = await supabase
      .from('parent_children')
      .select('parent:profiles(id, full_name, email, phone)')
      .eq('child_id', child.id);
    setParents((data || []).map(r => r.parent));
    setLoadingParents(false);
  }

  async function loadIncidents() {
    const { data } = await supabase
      .from('incident_reports')
      .select('*')
      .eq('child_id', child.id)
      .neq('status', 'draft')
      .order('occurred_at', { ascending: false })
      .limit(5);
    setIncidents(data || []);
  }

  async function handleSave() {
    if (!firstName.trim()) {
      Alert.alert('Required', "Please enter the child's first name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('children')
      .update({
        first_name:    firstName.trim(),
        last_name:     lastName.trim(),
        date_of_birth: dob || null,
      })
      .eq('id', child.id);
    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Saved ✓', `${firstName.trim()}'s profile has been updated.`, [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    }
  }

  async function handleInviteParent() {
    if (!inviteEmail.trim()) {
      Alert.alert('Required', "Please enter the parent's email address.");
      return;
    }
    setInviting(true);

    // Check if user already exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('email', inviteEmail.trim().toLowerCase())
      .single();

    if (existing) {
      // Already has an account — link directly. DO NOTHING (not DO UPDATE):
      // Phase 2 restricts UPDATE on parent_children to consent_given_at only.
      const { error } = await supabase
        .from('parent_children')
        .upsert(
          { parent_id: existing.id, child_id: child.id },
          { onConflict: 'parent_id,child_id', ignoreDuplicates: true }
        );
      setInviting(false);
      if (error) { Alert.alert('Error', error.message); return; }
      setInviteEmail('');
      await loadParents();
      Alert.alert('Linked ✓', `${existing.full_name} has been linked to ${child.first_name}.`);
    } else {
      // Send magic link invite — pending_child_id is processed by the
      // handle_new_user trigger to auto-link parent → child on signup
      const { error } = await supabase.auth.signInWithOtp({
        email: inviteEmail.trim().toLowerCase(),
        options: {
          data: { role: 'parent', pending_child_id: child.id },
          shouldCreateUser: true,
          emailRedirectTo: 'dailylog://auth',
        },
      });
      setInviting(false);
      if (error) { Alert.alert('Error', error.message); return; }
      setInviteEmail('');
      Alert.alert(
        'Invite sent ✓',
        `An invitation has been sent to ${inviteEmail.trim()}. Once they sign up, come back here to link them.`
      );
    }
  }

  async function handleUnlinkParent(parent) {
    Alert.alert(
      'Unlink parent',
      `Remove ${parent.full_name}'s access to ${child.first_name}'s daily logs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink', style: 'destructive',
          onPress: async () => {
            await supabase.from('parent_children')
              .delete()
              .eq('parent_id', parent.id)
              .eq('child_id', child.id);
            await loadParents();
          },
        },
      ]
    );
  }

  async function handleMoveClassroom(targetRoom) {
    if (targetRoom.id === currentClassroomId) return;
    Alert.alert(
      'Move child',
      `Move ${firstName} from "${activeClassroom?.name || 'current class'}" to "${targetRoom.name}"?\n\nAll their log history will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move', onPress: async () => {
            setMovingClass(true);
            const { error } = await supabase
              .from('children')
              .update({ classroom_id: targetRoom.id })
              .eq('id', child.id);
            setMovingClass(false);
            setShowMovePicker(false);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              setCurrentClassroomId(targetRoom.id);
              Alert.alert(
                'Moved ✓',
                `${firstName} has been moved to ${targetRoom.name}. They'll now appear in that classroom's roster.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }]
              );
            }
          },
        },
      ]
    );
  }

  function handleRemove() {
    Alert.alert(
      `Remove ${child.first_name}?`,
      'This will remove them from your classroom roster. Their log history will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            // Soft delete — archiving preserves logs, incidents and parent links
            const { error } = await supabase
              .from('children')
              .update({ archived_at: new Date().toISOString() })
              .eq('id', child.id);
            setRemoving(false);
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            navigation.goBack();
          },
        },
      ]
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      enableOnAndroid
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Child profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!hasChanges || saving}
          style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
        >
          <Text style={[styles.saveBtnText, (!hasChanges || saving) && styles.saveBtnTextDisabled]}>
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Avatar — tap to change photo */}
      <TouchableOpacity style={styles.avatarWrap} onPress={handleChangePhoto} activeOpacity={0.7}>
        <View style={styles.avatarContainer}>
          <ChildAvatar
            child={{ ...child, first_name: firstName, last_name: lastName, photo_url: photoUrl }}
            size={72}
          />
          <View style={styles.avatarBadge}>
            <Text style={styles.avatarBadgeText}>📷</Text>
          </View>
          {uploadingPhoto && (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator color={colors.white} />
            </View>
          )}
        </View>
        <Text style={styles.avatarName}>{firstName} {lastName}</Text>
        {dob && <Text style={styles.avatarDob}>Born {dob}</Text>}
        <Text style={styles.changePhotoHint}>Tap to change photo</Text>
      </TouchableOpacity>

      {/* Details form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Details</Text>
        <Input label="First name *" value={firstName} onChangeText={setFirstName} placeholder="e.g. Emma" />
        <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="e.g. Smith" />
        <DatePickerField label="Date of birth" value={dob} onChange={setDob} />
      </View>

      {hasChanges && (
        <Button label="Save changes" onPress={handleSave} loading={saving} style={styles.saveFullBtn} />
      )}

      {/* Classroom assignment */}
      {classrooms.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🏫 Classroom</Text>
          <View style={styles.classroomRow}>
            <View style={styles.classroomInfo}>
              <Text style={styles.classroomCurrentName}>
                {classrooms.find(r => r.id === currentClassroomId)?.name || 'Unknown'}
              </Text>
              {classrooms.find(r => r.id === currentClassroomId)?.age_group && (
                <Text style={styles.classroomCurrentAge}>
                  {classrooms.find(r => r.id === currentClassroomId)?.age_group}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setShowMovePicker(true)}
              style={styles.classMoveBtn}
              disabled={movingClass}
            >
              {movingClass
                ? <ActivityIndicator color={colors.white} size="small" />
                : <Text style={styles.classMoveBtnText}>Move to…</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Move classroom picker modal */}
      <Modal visible={showMovePicker} transparent animationType="slide">
        <View style={styles.moveOverlay}>
          <View style={styles.moveSheet}>
            <View style={styles.moveSheetHeader}>
              <Text style={styles.moveSheetTitle}>Move {firstName} to…</Text>
              <TouchableOpacity onPress={() => setShowMovePicker(false)}>
                <Text style={styles.moveSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.moveList}>
              {classrooms
                .filter(r => r.id !== currentClassroomId)
                .map(room => (
                  <TouchableOpacity
                    key={room.id}
                    onPress={() => handleMoveClassroom(room)}
                    style={styles.moveRoomRow}
                    activeOpacity={0.7}
                  >
                    <View style={styles.moveRoomIcon}>
                      <Text style={styles.moveRoomEmoji}>🏫</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.moveRoomName}>{room.name}</Text>
                      {room.age_group && <Text style={styles.moveRoomAge}>{room.age_group}</Text>}
                    </View>
                    <Text style={styles.moveRoomArrow}>→</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
            <Text style={styles.moveHint}>
              All log history & linked parents are preserved when you move a child.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Incident history */}
      <View style={styles.card}>
        <View style={styles.incidentHeader}>
          <Text style={styles.cardTitle}>⚠️ Incident reports</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('IncidentReport', { child: { ...child, first_name: firstName, last_name: lastName } })}
            style={styles.incidentNewBtn}
          >
            <Text style={styles.incidentNewBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>
        {incidents.length === 0 ? (
          <Text style={styles.noParents}>No incidents reported.</Text>
        ) : (
          incidents.map((incident, i) => {
            const sevColors = {
              minor: colors.amber,
              moderate: colors.coral,
              serious: colors.danger,
            };
            return (
              <View key={incident.id}>
                {i > 0 && <Divider />}
                <View style={styles.incidentRow}>
                  <View style={[styles.incidentDot, { backgroundColor: sevColors[incident.severity] || colors.amber }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.incidentType}>{incident.injury_type}</Text>
                    <Text style={styles.incidentMeta}>
                      {format(new Date(incident.occurred_at), 'MMM d · h:mm a')} ·{' '}
                      {incident.status === 'acknowledged' ? '✅ Acknowledged' : '⏳ Pending'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Linked parents */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👨‍👩‍👧 Linked parents</Text>

        {loadingParents ? (
          <ActivityIndicator color={colors.primary} />
        ) : parents.length === 0 ? (
          <Text style={styles.noParents}>No parents linked yet.</Text>
        ) : (
          parents.map((parent, i) => (
            <View key={parent.id}>
              {i > 0 && <Divider />}
              <View style={styles.parentRow}>
                <View style={styles.parentAvatar}>
                  <Text style={styles.parentInitial}>{parent.full_name?.[0] || '?'}</Text>
                </View>
                <View style={styles.parentInfo}>
                  <Text style={styles.parentName}>{parent.full_name}</Text>
                  <Text style={styles.parentEmail}>{parent.email}</Text>
                  {parent.phone ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(`tel:${parent.phone}`)}
                      style={styles.phoneRow}
                    >
                      <Text style={styles.phoneIcon}>📞</Text>
                      <Text style={styles.phoneText}>{parent.phone}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.noPhone}>No phone on file</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => handleUnlinkParent(parent)}
                  style={styles.unlinkBtn}
                >
                  <Text style={styles.unlinkBtnText}>Unlink</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <Divider />

        {/* Invite / link parent */}
        <Text style={styles.inviteLabel}>Link a parent by email</Text>
        <View style={styles.inviteRow}>
          <Input
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="parent@email.com"
            keyboardType="email-address"
            style={{ flex: 1, marginBottom: 0 }}
          />
          <TouchableOpacity
            onPress={handleInviteParent}
            disabled={inviting || !inviteEmail.trim()}
            style={[styles.inviteBtn, (!inviteEmail.trim() || inviting) && styles.inviteBtnDisabled]}
          >
            {inviting
              ? <ActivityIndicator color={colors.white} size="small" />
              : <Text style={styles.inviteBtnText}>Link</Text>
            }
          </TouchableOpacity>
        </View>
        <Text style={styles.inviteHint}>
          If they already have an account they'll be linked immediately. If not, they'll receive an invitation email.
        </Text>
      </View>

      <Divider />

      {/* Danger zone */}
      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>Remove from classroom</Text>
        <Text style={styles.dangerDesc}>
          Removes {firstName} from your roster. Their log history is kept and can be restored by re-adding them.
        </Text>
        <Button
          label={removing ? 'Removing...' : `Remove ${firstName}`}
          onPress={handleRemove}
          loading={removing}
          variant="danger"
          style={{ marginTop: spacing.md }}
        />
      </View>

      <View style={{ height: spacing.xxxl }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.xl,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  saveBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  saveBtnDisabled: { backgroundColor: colors.border },
  saveBtnText: { fontSize: 14, fontWeight: '600', color: colors.white },
  saveBtnTextDisabled: { color: colors.textMuted },

  avatarWrap: { alignItems: 'center', marginBottom: spacing.xl },
  avatarContainer: { position: 'relative', marginBottom: spacing.sm },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: -4,
    backgroundColor: colors.surface, borderRadius: 12,
    width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.border,
  },
  avatarBadgeText: { fontSize: 12 },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  avatarDob: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },
  changePhotoHint: { fontSize: 12, color: colors.primary, marginTop: spacing.xs, fontWeight: '500' },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  saveFullBtn: { marginBottom: spacing.lg },

  noParents: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  parentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  parentAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.purpleLight, alignItems: 'center', justifyContent: 'center',
  },
  parentInitial: { fontSize: 15, fontWeight: '700', color: colors.purple },
  parentInfo: { flex: 1 },
  parentName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  parentEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  phoneIcon: { fontSize: 11 },
  phoneText: { fontSize: 12, color: colors.primary, fontWeight: '500', textDecorationLine: 'underline' },
  noPhone: { fontSize: 12, color: colors.textMuted, marginTop: 3, fontStyle: 'italic' },
  unlinkBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 1, borderRadius: radius.full,
  },
  unlinkBtnText: { fontSize: 12, color: colors.danger, fontWeight: '500' },

  inviteLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  inviteBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', minWidth: 64,
  },
  inviteBtnDisabled: { backgroundColor: colors.border },
  inviteBtnText: { fontSize: 14, color: colors.white, fontWeight: '600' },
  inviteHint: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },

  dangerCard: {
    backgroundColor: colors.dangerLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.danger + '33',
    padding: spacing.lg, marginTop: spacing.sm,
  },
  dangerTitle: { fontSize: 15, fontWeight: '600', color: colors.danger, marginBottom: spacing.xs },
  dangerDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  incidentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  incidentNewBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1, borderRadius: radius.full,
  },
  incidentNewBtnText: { fontSize: 12, color: colors.danger, fontWeight: '600' },
  incidentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  incidentDot: { width: 10, height: 10, borderRadius: 5 },
  incidentType: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  incidentMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  // Classroom assignment — compact row + modal
  classroomRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  classroomInfo: { flex: 1 },
  classroomCurrentName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  classroomCurrentAge: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  classMoveBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2, borderRadius: radius.full,
    minWidth: 90, alignItems: 'center',
  },
  classMoveBtnText: { fontSize: 13, color: colors.white, fontWeight: '600' },

  // Move modal
  moveOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  moveSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 40, maxHeight: '60%',
  },
  moveSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  moveSheetTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  moveSheetClose: { fontSize: 20, color: colors.textSecondary, fontWeight: '600', padding: spacing.xs },
  moveList: { paddingHorizontal: spacing.md },
  moveRoomRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  moveRoomIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  moveRoomEmoji: { fontSize: 18 },
  moveRoomName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  moveRoomAge: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  moveRoomArrow: { fontSize: 20, color: colors.primary, fontWeight: '700' },
  moveHint: {
    fontSize: 12, color: colors.textMuted, lineHeight: 17,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
});
