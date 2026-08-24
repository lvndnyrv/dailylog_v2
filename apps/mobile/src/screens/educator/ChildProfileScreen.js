import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, Linking, ActivityIndicator, Modal, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { useClassroom } from '../../hooks/useClassroom';
import { Input, Button, Divider } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { DatePickerField } from '../../components/DatePickerField';
import { colors, fonts, spacing, radius } from '../../theme';
import { format } from 'date-fns';

function formatBirthDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'MMM d, yyyy');
}

export default function ChildProfileScreen({ route, navigation }) {
  const { child } = route.params;
  const { classrooms, active: activeClassroom } = useClassroom();

  const [firstName, setFirstName] = useState(child.first_name || '');
  const [lastName, setLastName]   = useState(child.last_name  || '');
  const [dob, setDob]             = useState(child.date_of_birth || '');
  const [photoUrl, setPhotoUrl]   = useState(child.photo_url || null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [errors, setErrors]       = useState({});
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
  const [existingParents, setExistingParents] = useState([]);
  const [showParentPicker, setShowParentPicker] = useState(false);

  // Incidents history
  const [incidents, setIncidents] = useState([]);

  // Medical profile
  const [allergies, setAllergies]           = useState(child.allergies || []);
  const [newAllergy, setNewAllergy]         = useState('');
  const [medicalNotes, setMedicalNotes]     = useState(child.medical_notes || '');
  const [contacts, setContacts]             = useState(child.emergency_contacts || []);
  const [newContact, setNewContact]         = useState({ name: '', relation: '', phone: '' });
  const [savingMedical, setSavingMedical]   = useState(false);

  const hasChanges =
    firstName.trim() !== (child.first_name   || '') ||
    lastName.trim()  !== (child.last_name    || '') ||
    dob              !== (child.date_of_birth || '');

  const currentClassroom = classrooms.find((room) => room.id === currentClassroomId);
  const profileSections = [
    {
      label: 'Details',
      complete: Boolean(firstName.trim() && lastName.trim()),
    },
    {
      label: 'Classroom',
      complete: Boolean(currentClassroomId),
    },
    {
      label: 'Medical info',
      complete: Boolean(allergies.length || medicalNotes.trim()),
    },
    {
      label: 'Emergency contacts',
      complete: contacts.length > 0,
    },
    {
      label: 'Linked parents',
      complete: parents.length > 0,
    },
  ];
  const completedSections = profileSections.filter((section) => section.complete).length;
  const profilePercent = completedSections * 20;
  const missingSections = profileSections.filter((section) => !section.complete);

  useEffect(() => {
    loadParents();
    loadIncidents();
    loadExistingParents();
  }, []);

  // Load all parents in the daycare (for "link existing" picker)
  async function loadExistingParents() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'parent')
      .order('full_name');
    setExistingParents(data || []);
  }

  async function linkExistingParent(parent) {
    const { error } = await supabase
      .from('parent_children')
      .upsert(
        { parent_id: parent.id, child_id: child.id },
        { onConflict: 'parent_id,child_id', ignoreDuplicates: true }
      );
    setShowParentPicker(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await loadParents();
    }
  }

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

      // Read file as ArrayBuffer (reliable in React Native unlike blob)
      const response = await fetch(manipResult.uri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${child.id}/avatar_${Date.now()}.jpg`;

      // Remove old avatar if exists
      if (photoUrl) {
        await supabase.storage.from('child-avatars').remove([photoUrl]);
      }

      // Upload new avatar
      const { error: uploadError } = await supabase.storage
        .from('child-avatars')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

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

  // ─── MEDICAL PROFILE ──────────────────────────────────────────────────────
  async function saveMedical(updates) {
    setSavingMedical(true);
    const { error } = await supabase
      .from('children')
      .update(updates)
      .eq('id', child.id);
    setSavingMedical(false);
    if (error) Alert.alert('Error', error.message);
  }

  function addAllergy() {
    const a = newAllergy.trim();
    if (!a || allergies.includes(a)) { setNewAllergy(''); return; }
    const next = [...allergies, a];
    setAllergies(next);
    setNewAllergy('');
    saveMedical({ allergies: next });
  }

  function removeAllergy(a) {
    const next = allergies.filter(x => x !== a);
    setAllergies(next);
    saveMedical({ allergies: next });
  }

  function addContact() {
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      Alert.alert('Required', 'Please enter at least a name and phone number.');
      return;
    }
    const next = [...contacts, { ...newContact, name: newContact.name.trim(), phone: newContact.phone.trim() }];
    setContacts(next);
    setNewContact({ name: '', relation: '', phone: '' });
    saveMedical({ emergency_contacts: next });
  }

  function removeContact(idx) {
    const next = contacts.filter((_, i) => i !== idx);
    setContacts(next);
    saveMedical({ emergency_contacts: next });
  }

  async function handleSave() {
    const errs = {};
    if (!firstName.trim()) errs.firstName = 'First name is required';
    if (!lastName.trim()) errs.lastName = 'Last name is required';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

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
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerSide}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Child profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Save child profile"
        >
          <Text style={styles.saveBtnText}>
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Avatar — tap to change photo */}
      <TouchableOpacity style={styles.avatarWrap} onPress={handleChangePhoto} activeOpacity={0.7}>
        <View style={styles.avatarContainer}>
          <ChildAvatar
            child={{ ...child, first_name: firstName, last_name: lastName, photo_url: photoUrl }}
            size={88}
          />
          <View style={styles.avatarBadge}>
            <Ionicons name="camera-outline" size={15} color={colors.white} />
          </View>
          {uploadingPhoto && (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator color={colors.white} />
            </View>
          )}
        </View>
        <Text style={styles.avatarName}>{firstName} {lastName}</Text>
        <Text style={styles.avatarDob}>
          {dob ? `Born ${formatBirthDate(dob)}` : 'Date of birth not added'}
          {currentClassroom ? ` · ${currentClassroom.name}` : ''}
        </Text>
      </TouchableOpacity>

      {/* Profile completeness nudge */}
      {!loadingParents && missingSections.length > 0 && (
        <View style={styles.completenessCard}>
          <View style={styles.completenessHeader}>
            <Text style={styles.completenessTitle}>Profile {profilePercent}% complete</Text>
            <Text style={styles.completenessCount}>{completedSections} of 5 sections</Text>
          </View>
          <View style={styles.completenessTrack}>
            <View style={[styles.completenessFill, { width: `${profilePercent}%` }]} />
          </View>
          <View style={styles.completenessChips}>
            {missingSections.map((section) => (
              <View key={section.label} style={styles.completenessChip}>
                <Text style={styles.completenessChipText}>{section.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Details form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Details</Text>
        <Input
          label="First name (required)"
          value={firstName}
          onChangeText={(v) => { setFirstName(v); if (errors.firstName) setErrors(e => ({ ...e, firstName: null })); }}
          placeholder="e.g. Emma"
          error={errors.firstName}
        />
        <Input
          label="Last name (required)"
          value={lastName}
          onChangeText={(v) => { setLastName(v); if (errors.lastName) setErrors(e => ({ ...e, lastName: null })); }}
          placeholder="e.g. Smith"
          error={errors.lastName}
        />
        <DatePickerField label="Date of birth (optional)" value={dob} onChange={setDob} />
      </View>

      {hasChanges && (
        <Button label="Save changes" onPress={handleSave} loading={saving} style={styles.saveFullBtn} />
      )}

      {/* Classroom assignment */}
      <View style={[styles.card, styles.classroomCard]}>
        <View style={styles.classroomRow}>
          <View style={styles.classroomInfo}>
            <Text style={styles.cardTitleCompact}>Classroom</Text>
            <Text style={styles.classroomCurrentName}>
              {currentClassroom?.name || 'Not assigned'}
            </Text>
            {currentClassroom?.age_group ? (
              <Text style={styles.classroomCurrentAge}>{currentClassroom.age_group}</Text>
            ) : null}
          </View>
          {classrooms.length > 1 ? (
            <TouchableOpacity
              onPress={() => setShowMovePicker(true)}
              style={styles.classMoveBtn}
              disabled={movingClass}
            >
              {movingClass
                ? <ActivityIndicator color={colors.primary} size="small" />
                : <Text style={styles.classMoveBtnText}>Move to…</Text>
              }
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

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

      {/* Medical profile */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Medical & emergency</Text>

        {/* Allergies */}
        <Text style={styles.medLabel}>Allergies</Text>
        {allergies.length > 0 && (
          <View style={styles.allergyWrap}>
            {allergies.map(a => (
              <TouchableOpacity
                key={a}
                style={styles.allergyChip}
                onLongPress={() => Alert.alert('Remove allergy', `Remove "${a}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => removeAllergy(a) },
                ])}
              >
                <Text style={styles.allergyChipText}>{a}  ×</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={styles.medAddRow}>
          <Input
            value={newAllergy}
            onChangeText={setNewAllergy}
            placeholder="e.g. Peanuts"
            style={{ flex: 1, marginBottom: 0 }}
          />
          <TouchableOpacity
            onPress={addAllergy}
            disabled={!newAllergy.trim()}
            style={[styles.medAddBtn, !newAllergy.trim() && styles.medAddBtnDisabled]}
          >
            <Text style={styles.medAddBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
        {allergies.length > 0 && (
          <Text style={styles.medHint}>Hold an allergy chip to remove it.</Text>
        )}

        <Divider />

        {/* Emergency contacts */}
        <Text style={styles.medLabel}>Emergency contacts</Text>
        {contacts.map((c, idx) => (
          <View key={idx} style={styles.contactRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>{c.name}{c.relation ? ` · ${c.relation}` : ''}</Text>
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${c.phone}`)}>
                <Text style={styles.contactPhone}>📞 {c.phone}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => removeContact(idx)} style={styles.unlinkBtn}>
              <Text style={styles.unlinkBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <Input
          value={newContact.name}
          onChangeText={t => setNewContact(p => ({ ...p, name: t }))}
          placeholder="Contact name"
        />
        <View style={styles.medAddRow}>
          <Input
            value={newContact.relation}
            onChangeText={t => setNewContact(p => ({ ...p, relation: t }))}
            placeholder="Relation (e.g. Grandma)"
            style={{ flex: 1, marginBottom: 0 }}
          />
          <Input
            value={newContact.phone}
            onChangeText={t => setNewContact(p => ({ ...p, phone: t }))}
            placeholder="Phone"
            keyboardType="phone-pad"
            style={{ flex: 1, marginBottom: 0 }}
          />
        </View>
        <TouchableOpacity
          onPress={addContact}
          style={[styles.medAddBtn, { alignSelf: 'flex-start', marginTop: spacing.sm }]}
        >
          <Text style={styles.medAddBtnText}>+ Add contact</Text>
        </TouchableOpacity>

        <Divider />

        {/* Medical notes */}
        <Text style={styles.medLabel}>Medical notes</Text>
        <Input
          value={medicalNotes}
          onChangeText={setMedicalNotes}
          placeholder="e.g. Carries EpiPen; inhaler in cubby"
          multiline
        />
        <TouchableOpacity
          onPress={() => saveMedical({ medical_notes: medicalNotes.trim() || null })}
          disabled={savingMedical}
          style={[styles.medAddBtn, { alignSelf: 'flex-start' }]}
        >
          {savingMedical
            ? <ActivityIndicator color={colors.white} size="small" />
            : <Text style={styles.medAddBtnText}>Save notes</Text>}
        </TouchableOpacity>

        <Divider />

        {/* Medications link */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Medication', { child: { ...child, first_name: firstName, last_name: lastName } })}
          style={styles.medLink}
        >
          <View style={styles.medLinkIcon}>
            <Ionicons name="medical-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.medLinkTitle}>Medications</Text>
            <Text style={styles.medLinkSub}>Authorizations & administration log</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </TouchableOpacity>

        <Divider />

        <TouchableOpacity
          onPress={() => navigation.navigate('ChildConsents', { childId: child.id, child: { ...child, first_name: firstName, last_name: lastName } })}
          style={styles.medLink}
        >
          <View style={styles.medLinkIcon}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.medLinkTitle}>Permissions & consents</Text>
            <Text style={styles.medLinkSub}>Parent-controlled activity permissions</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Linked parents */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Linked parents</Text>

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

        {/* Link existing parent */}
        {existingParents.filter(p => !parents.find(lp => lp.id === p.id)).length > 0 && (
          <>
            <Text style={styles.inviteLabel}>Link an existing parent</Text>
            <TouchableOpacity
              style={styles.linkExistingBtn}
              onPress={() => setShowParentPicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.linkExistingBtnText}>Choose from existing parents</Text>
              <Text style={styles.linkExistingChevron}>›</Text>
            </TouchableOpacity>
            <Divider />
          </>
        )}

        {/* Invite / link parent by email */}
        <Text style={styles.inviteLabel}>Invite a new parent by email</Text>
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
              : <Text style={styles.inviteBtnText}>Invite</Text>
            }
          </TouchableOpacity>
        </View>
        <Text style={styles.inviteHint}>
          They'll receive an email invitation. Once they sign up, they'll be automatically linked.
        </Text>
      </View>

      {/* Parent picker modal */}
      <Modal visible={showParentPicker} transparent animationType="slide">
        <View style={styles.moveOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowParentPicker(false)} />
          <View style={styles.moveSheet}>
            <View style={styles.moveSheetHeader}>
              <Text style={styles.moveSheetTitle}>Link a parent</Text>
              <TouchableOpacity onPress={() => setShowParentPicker(false)}>
                <Text style={styles.moveSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.moveList}>
              {existingParents
                .filter(p => !parents.find(lp => lp.id === p.id))
                .map(parent => (
                  <TouchableOpacity
                    key={parent.id}
                    onPress={() => linkExistingParent(parent)}
                    style={styles.moveRoomRow}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.parentAvatar, { width: 36, height: 36, borderRadius: 18 }]}>
                      <Text style={styles.parentInitial}>{parent.full_name?.[0] || '?'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.moveRoomName}>{parent.full_name}</Text>
                      <Text style={styles.moveRoomAge}>{parent.email}</Text>
                    </View>
                    <Text style={styles.linkExistingChevron}>+</Text>
                  </TouchableOpacity>
                ))}
              {existingParents.filter(p => !parents.find(lp => lp.id === p.id)).length === 0 && (
                <Text style={[styles.noParents, { padding: spacing.xl, textAlign: 'center' }]}>
                  No other parents available to link.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Incident history — retained below the Group 13 profile sections. */}
      <View style={styles.card}>
        <View style={styles.incidentHeader}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="warning-outline" size={18} color={colors.danger} />
            <Text style={styles.cardTitleInline}>Incident reports</Text>
          </View>
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
                      {incident.status === 'acknowledged' ? 'Acknowledged' : 'Pending'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

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
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },

  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.lg,
  },
  headerSide: {
    width: 64,
    minHeight: 36,
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: fonts.black, color: colors.textPrimary },
  saveBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: radius.full,
    minWidth: 64,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: colors.border },
  saveBtnText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.white },

  avatarWrap: { alignItems: 'center', marginBottom: spacing.xl },
  avatarContainer: { position: 'relative', marginBottom: spacing.sm },
  avatarBadge: {
    position: 'absolute', bottom: -2, right: -2,
    backgroundColor: colors.primary, borderRadius: 15,
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: colors.bg,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44, backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarName: { fontSize: 20, fontFamily: fonts.black, color: colors.textPrimary },
  avatarDob: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 3,
    textAlign: 'center',
  },

  // Profile completeness
  completenessCard: {
    backgroundColor: colors.amberLight, borderRadius: 16,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  completenessHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  completenessTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.amber },
  completenessCount: { fontSize: 12, fontFamily: fonts.bold, color: colors.amber },
  completenessTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: '#F0E2C4',
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  completenessFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.amber,
  },
  completenessChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  completenessChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  completenessChipText: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.amber },

  card: {
    backgroundColor: colors.surface, borderRadius: 18,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 15, fontFamily: fonts.black, color: colors.textPrimary, marginBottom: spacing.lg },
  cardTitleCompact: {
    fontSize: 15,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    marginBottom: 3,
  },
  cardTitleInline: { fontSize: 15, fontFamily: fonts.black, color: colors.textPrimary },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  saveFullBtn: { marginBottom: spacing.lg },

  noParents: { fontSize: 13, fontFamily: fonts.regular, color: colors.textMuted, marginBottom: spacing.md },
  parentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  parentAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.purpleLight, alignItems: 'center', justifyContent: 'center',
  },
  parentInitial: { fontSize: 15, fontFamily: fonts.bold, color: colors.purple },
  parentInfo: { flex: 1 },
  parentName: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  parentEmail: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 1 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  phoneIcon: { fontSize: 11 },
  phoneText: { fontSize: 12, color: colors.primary, fontWeight: '500', textDecorationLine: 'underline' },
  noPhone: { fontSize: 12, color: colors.textMuted, marginTop: 3, fontStyle: 'italic' },
  unlinkBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 1, borderRadius: radius.full,
  },
  unlinkBtnText: { fontSize: 12, color: colors.danger, fontWeight: '500' },

  // Link existing parent
  linkExistingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary + '33',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  linkExistingBtnText: { fontSize: 14, fontWeight: '500', color: colors.primary },
  linkExistingChevron: { fontSize: 20, color: colors.primary, fontWeight: '600' },

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
  dangerTitle: { fontSize: 15, fontFamily: fonts.black, color: colors.danger, marginBottom: spacing.xs },
  dangerDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, lineHeight: 18 },

  incidentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  incidentNewBtn: {
    backgroundColor: colors.dangerLight, paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1, borderRadius: radius.full,
  },
  incidentNewBtnText: { fontSize: 12, color: colors.danger, fontFamily: fonts.bold },
  incidentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  incidentDot: { width: 10, height: 10, borderRadius: 5 },
  incidentType: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  incidentMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  // Classroom assignment — compact row + modal
  classroomCard: {
    paddingVertical: spacing.lg,
  },
  classroomRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  classroomInfo: { flex: 1 },
  classroomCurrentName: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary },
  classroomCurrentAge: { fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint, marginTop: 2 },
  classMoveBtn: {
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 1, borderRadius: radius.full,
    borderWidth: 1.8, borderColor: colors.primary,
    minWidth: 90, alignItems: 'center',
  },
  classMoveBtnText: { fontSize: 13, color: colors.primary, fontFamily: fonts.bold },

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

  // Medical section
  medLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary, marginBottom: spacing.sm },
  allergyWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  allergyChip: {
    backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: colors.danger + '55',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
  },
  allergyChipText: { fontSize: 13, color: colors.danger, fontFamily: fonts.bold },
  medAddRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  medAddBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  medAddBtnDisabled: { backgroundColor: colors.border },
  medAddBtnText: { fontSize: 13, color: colors.white, fontWeight: '600' },
  medHint: { fontSize: 11, color: colors.textMuted, marginTop: spacing.xs },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  contactName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  contactPhone: { fontSize: 13, color: colors.primary, marginTop: 2, fontWeight: '500' },
  medLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  medLinkIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medLinkTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  medLinkSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 1 },
});
