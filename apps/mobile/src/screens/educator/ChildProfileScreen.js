import React, { useCallback, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, Linking, ActivityIndicator, Modal, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { KeyboardAwareScrollView } from '../../components/KeyboardAwareScrollView';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { Input, Button, Divider } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { DatePickerField } from '../../components/DatePickerField';
import { showToast } from '../../components/Toast';
import { colors, fonts, spacing, radius } from '../../theme';
import { format } from 'date-fns';
import {
  getStaffPickupPeople,
  reviewAuthorizedPickup,
} from '../../hooks/usePickupVerification';

function formatBirthDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, 'MMM d, yyyy');
}

export default function ChildProfileScreen({ route, navigation }) {
  const suppliedChild = route.params?.child || null;
  const childId = route.params?.childId || suppliedChild?.id || null;
  const [resolvedChild, setResolvedChild] = useState(suppliedChild);
  const [loadingChild, setLoadingChild] = useState(!suppliedChild);
  const [childError, setChildError] = useState('');

  useEffect(() => {
    if (suppliedChild) {
      setResolvedChild(suppliedChild);
      setLoadingChild(false);
      setChildError('');
      return;
    }
    let active = true;
    async function loadChild() {
      if (!childId) {
        setChildError('This child record could not be identified.');
        setLoadingChild(false);
        return;
      }
      setLoadingChild(true);
      setChildError('');
      const { data, error } = await supabase.from('children').select('*').eq('id', childId).maybeSingle();
      if (!active) return;
      setResolvedChild(data || null);
      setChildError(error?.message || (!data ? 'This child record is no longer available.' : ''));
      setLoadingChild(false);
    }
    loadChild();
    return () => { active = false; };
  }, [childId, suppliedChild]);

  if (loadingChild) {
    return <View style={styles.routeState}><ActivityIndicator color={colors.primary} /><Text style={styles.routeStateText}>Opening child profile…</Text></View>;
  }
  if (!resolvedChild) {
    return (
      <View style={styles.routeState}>
        <Ionicons name="alert-circle-outline" size={34} color={colors.danger} />
        <Text style={styles.routeStateTitle}>Child profile unavailable</Text>
        <Text style={styles.routeStateText}>{childError}</Text>
        <Button label="Go back" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} />
      </View>
    );
  }
  return <ChildProfileContent key={resolvedChild.id} child={resolvedChild} route={route} navigation={navigation} />;
}

function ChildProfileContent({ child, route, navigation }) {
  const { profile } = useAuth();
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
  const [inviteRelationship, setInviteRelationship] = useState('Parent');
  const [inviteErrors, setInviteErrors] = useState({});
  const [inviting, setInviting]       = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [busyInviteId, setBusyInviteId] = useState(null);
  const [existingParents, setExistingParents] = useState([]);
  const [showParentPicker, setShowParentPicker] = useState(false);
  const [selectedExistingParent, setSelectedExistingParent] = useState(null);
  const [existingRelationship, setExistingRelationship] = useState('Parent');
  const [existingPickupAllowed, setExistingPickupAllowed] = useState(true);
  const [existingLinkError, setExistingLinkError] = useState('');
  const [linkingExisting, setLinkingExisting] = useState(false);
  const [busyPrimaryId, setBusyPrimaryId] = useState(null);

  // Parent-proposed pickup people and center review.
  const [pickupPeople, setPickupPeople] = useState([]);
  const [loadingPickups, setLoadingPickups] = useState(true);
  const [canReviewPickups, setCanReviewPickups] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const [reviewingPickupId, setReviewingPickupId] = useState(null);
  const [rejectingPickup, setRejectingPickup] = useState(null);
  const [reviewNote, setReviewNote] = useState('');

  // Incidents history
  const [incidents, setIncidents] = useState([]);

  // Medical profile
  const [allergies, setAllergies]           = useState(child.allergies || []);
  const [newAllergy, setNewAllergy]         = useState('');
  const [medicalNotes, setMedicalNotes]     = useState(child.medical_notes || '');
  const [contacts, setContacts]             = useState(child.emergency_contacts || []);
  const [newContact, setNewContact]         = useState({ name: '', relation: '', phone: '' });
  const [savingMedical, setSavingMedical]   = useState(false);

  const initialSetupState = child.setup_state && typeof child.setup_state === 'object' && !Array.isArray(child.setup_state)
    ? child.setup_state
    : {};
  const [noKnownMedicalNeeds, setNoKnownMedicalNeeds] = useState(Boolean(initialSetupState.no_known_medical_needs));
  const [medicalReviewed, setMedicalReviewed] = useState(Boolean(
    initialSetupState.medical_reviewed
    || initialSetupState.no_known_medical_needs
    || (child.allergies || []).length
    || String(child.medical_notes || '').trim(),
  ));

  const hasChanges =
    firstName.trim() !== (child.first_name   || '') ||
    lastName.trim()  !== (child.last_name    || '') ||
    dob              !== (child.date_of_birth || '');

  const currentClassroom = classrooms.find((room) => room.id === currentClassroomId);
  const setupState = initialSetupState;
  const primaryEducatorName = String(setupState.primary_educator_name || '');
  const cubbyLabel = String(setupState.cubby_label || '');
  const isPrimaryEducator = String(setupState.primary_educator_id || '') === String(profile?.id || '');
  const handoffReady = Boolean(primaryEducatorName && cubbyLabel);
  const canManageFamilyDocuments = ['owner_admin', 'admin'].includes(profile?.role);
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
      complete: medicalReviewed,
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

  const loadPickupPeople = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingPickups(true);
    try {
      const result = await getStaffPickupPeople(child.id);
      setPickupPeople(result.people);
      setCanReviewPickups(result.canReview);
      setPickupError('');
    } catch (loadError) {
      setPickupError(loadError.message || 'Pickup people could not be loaded.');
    } finally {
      setLoadingPickups(false);
    }
  }, [child.id]);

  useFocusEffect(useCallback(() => {
    loadPickupPeople();
  }, [loadPickupPeople, route.params?.linkedAt, route.params?.pickupId]));

  useEffect(() => {
    const channel = supabase
      .channel(`staff-child-pickups:${child.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'child_pickups', filter: `child_id=eq.${child.id}`,
      }, () => loadPickupPeople({ quiet: true }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [child.id, loadPickupPeople]);

  async function submitPickupReview(person, decision, note = null) {
    setReviewingPickupId(person.id);
    setPickupError('');
    try {
      await reviewAuthorizedPickup(person.id, decision, note);
      await loadPickupPeople({ quiet: true });
      setRejectingPickup(null);
      setReviewNote('');
      showToast(
        decision === 'approved'
          ? `${person.full_name} approved for pickup`
          : `${person.full_name} was not approved`,
        'success',
      );
    } catch (reviewError) {
      setPickupError(reviewError.message || 'This pickup request could not be reviewed.');
    } finally {
      setReviewingPickupId(null);
    }
  }

  function approvePickup(person) {
    Alert.alert(
      'Approve pickup person?',
      `${person.full_name} will be able to receive a short-lived pickup pass for ${firstName}. Educators must still verify the pass at the door.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => submitPickupReview(person, 'approved') },
      ],
    );
  }

  function openRejectPickup(person) {
    setReviewNote('');
    setPickupError('');
    setRejectingPickup(person);
  }

  // Load all parents in the daycare (for "link existing" picker)
  async function loadExistingParents() {
    let query = supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'parent')
      .order('full_name');
    if (profile?.daycare_id) query = query.eq('daycare_id', profile.daycare_id);
    const { data } = await query;
    setExistingParents(data || []);
  }

  function closeParentPicker() {
    if (linkingExisting) return;
    setShowParentPicker(false);
    setSelectedExistingParent(null);
    setExistingRelationship('Parent');
    setExistingPickupAllowed(true);
    setExistingLinkError('');
  }

  function selectExistingParent(parent) {
    setSelectedExistingParent(parent);
    setExistingRelationship('Parent');
    setExistingPickupAllowed(true);
    setExistingLinkError('');
  }

  async function linkExistingParent() {
    const relationship = existingRelationship.trim();
    if (!relationship) {
      setExistingLinkError('Relationship is required.');
      return;
    }
    if (!selectedExistingParent) return;
    setLinkingExisting(true);
    const { error } = await supabase.rpc('admin_link_existing_guardian', {
      p_child_id: child.id,
      p_parent_id: selectedExistingParent.id,
      p_relationship: relationship,
      p_pickup_authorized: existingPickupAllowed,
    });
    setLinkingExisting(false);
    if (error) {
      setExistingLinkError(error.message);
    } else {
      const linkedName = selectedExistingParent.full_name;
      closeParentPicker();
      await loadParents();
      showToast(`${linkedName} linked to ${child.first_name}`, 'success');
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
    const [parentRes, inviteRes] = await Promise.all([
      supabase.from('parent_children')
        .select('relationship, pickup_authorized, is_primary, parent:profiles(id, full_name, email, phone)')
        .eq('child_id', child.id),
      supabase.from('child_invite_codes')
        .select('id, email, relationship, code, created_at, expires_at')
        .eq('child_id', child.id)
        .is('used_at', null)
        .order('created_at', { ascending: false }),
    ]);
    setParents((parentRes.data || []).map(row => {
      const parent = Array.isArray(row.parent) ? row.parent[0] : row.parent;
      return parent ? { ...parent, relationship: row.relationship, pickup_authorized: row.pickup_authorized, is_primary: row.is_primary } : null;
    }).filter(Boolean));
    setPendingInvites(inviteRes.data || []);
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
  async function saveMedical({
    allergies: nextAllergies = allergies,
    medicalNotes: nextMedicalNotes = medicalNotes,
    contacts: nextContacts = contacts,
    noKnownMedicalNeeds: nextNoKnownMedicalNeeds = noKnownMedicalNeeds,
  } = {}) {
    setSavingMedical(true);
    const { data, error } = await supabase.rpc('save_child_care_profile', {
      p_child_id: child.id,
      p_allergies: nextAllergies,
      p_medical_notes: nextMedicalNotes.trim() || null,
      p_emergency_contacts: nextContacts,
      p_no_known_medical_needs: nextNoKnownMedicalNeeds,
    });
    setSavingMedical(false);
    if (error) {
      Alert.alert('Could not save medical profile', error.message);
      return false;
    }
    setAllergies(data?.allergies || []);
    setMedicalNotes(data?.medical_notes || '');
    setContacts(data?.emergency_contacts || []);
    setNoKnownMedicalNeeds(Boolean(data?.setup_state?.no_known_medical_needs));
    setMedicalReviewed(true);
    return true;
  }

  async function addAllergy() {
    const a = newAllergy.trim();
    if (!a || allergies.some((item) => item.toLowerCase() === a.toLowerCase())) { setNewAllergy(''); return; }
    const next = [...allergies, a];
    if (await saveMedical({ allergies: next, noKnownMedicalNeeds: false })) setNewAllergy('');
  }

  async function removeAllergy(a) {
    const next = allergies.filter(x => x !== a);
    await saveMedical({ allergies: next, noKnownMedicalNeeds: false });
  }

  async function addContact() {
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      Alert.alert('Required', 'Please enter at least a name and phone number.');
      return;
    }
    const next = [...contacts, {
      name: newContact.name.trim(),
      relation: newContact.relation.trim(),
      phone: newContact.phone.trim(),
    }];
    if (await saveMedical({ contacts: next })) setNewContact({ name: '', relation: '', phone: '' });
  }

  async function removeContact(idx) {
    const next = contacts.filter((_, i) => i !== idx);
    await saveMedical({ contacts: next });
  }

  async function toggleNoKnownMedicalNeeds() {
    const next = !noKnownMedicalNeeds;
    if (next && (allergies.length || medicalNotes.trim())) {
      Alert.alert(
        'Medical details already recorded',
        'Remove the allergies and medical notes before marking that there are no known medical needs.',
      );
      return;
    }
    await saveMedical({ noKnownMedicalNeeds: next });
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
    const email = inviteEmail.trim().toLowerCase();
    const relationship = inviteRelationship.trim();
    const nextErrors = {};
    if (!email) nextErrors.email = 'Email is required.';
    else if (!/\S+@\S+\.\S+/.test(email)) nextErrors.email = 'Enter a valid email address.';
    if (!relationship) nextErrors.relationship = 'Relationship is required.';
    setInviteErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setInviting(true);
    const { data: code, error } = await supabase.rpc('create_parent_invite', {
      p_child_id: child.id,
      p_email: email,
      p_relationship: relationship,
    });
    if (error) {
      setInviting(false);
      setInviteErrors({ form: error.message });
      return;
    }
    const { error: emailError } = await supabase.rpc('enqueue_email_notification', {
      p_daycare_id: profile.daycare_id,
      p_recipient_email: email,
      p_kind: 'parent_invite',
      p_title: "You're invited to your child's DailyLog",
      p_body: `Create or sign in to your DailyLog parent account, then enter this one-time code: ${code}`,
      p_payload: { type: 'parent_invite', inviteCode: code, childId: child.id },
      p_dedupe_key: `parent-invite:${code}`,
    });
    setInviting(false);
    setInviteEmail('');
    setInviteRelationship('Parent');
    setInviteErrors({});
    await loadParents();
    Alert.alert(
      emailError ? 'Invite created' : 'Invite sent',
      emailError
        ? `The email could not be queued, but this 7-day code can be shared securely:\n\n${code}`
        : `${email} will receive a 7-day, single-use code.\n\nCode: ${code}`,
    );
  }

  function cancelInvite(invite) {
    Alert.alert('Cancel family invite?', `${invite.email} will no longer be able to use this code.`, [
      { text: 'Keep invite', style: 'cancel' },
      {
        text: 'Cancel invite', style: 'destructive', onPress: async () => {
          setBusyInviteId(invite.id);
          const { error } = await supabase.rpc('admin_cancel_parent_invite', {
            p_invite_id: invite.id,
          });
          setBusyInviteId(null);
          if (error) Alert.alert('Could not cancel invite', error.message);
          else {
            showToast('Family invite cancelled', 'success');
            loadParents();
          }
        },
      },
    ]);
  }

  async function resendInvite(invite) {
    setBusyInviteId(invite.id);
    const { data: renewedInvite, error: updateError } = await supabase.rpc('admin_renew_parent_invite', {
      p_invite_id: invite.id,
    });
    if (updateError) {
      setBusyInviteId(null);
      Alert.alert('Could not renew invite', updateError.message);
      return;
    }
    const renewedCode = renewedInvite?.code || invite.code;
    const renewedEmail = renewedInvite?.email || invite.email;
    const { error: emailError } = await supabase.rpc('enqueue_email_notification', {
      p_daycare_id: profile.daycare_id,
      p_recipient_email: renewedEmail,
      p_kind: 'parent_invite',
      p_title: "Reminder: link to your child's DailyLog",
      p_body: `Create or sign in to DailyLog, then enter this one-time code: ${renewedCode}`,
      p_payload: { type: 'parent_invite', inviteCode: renewedCode, childId: child.id },
      p_dedupe_key: `parent-invite-reminder:${invite.id}:${new Date().toISOString()}`,
    });
    setBusyInviteId(null);
    await loadParents();
    if (emailError) Alert.alert('Invite renewed', `The email was not queued. Share this code securely: ${renewedCode}`);
    else showToast(`Invite resent to ${renewedEmail}`, 'success');
  }

  async function handleUnlinkParent(parent) {
    Alert.alert(
      'Unlink family member',
      `${parent.is_primary && parents.length > 1 ? 'This is the primary guardian. The next linked guardian will be promoted automatically.\n\n' : ''}Remove ${parent.full_name}'s access to ${child.first_name}'s daily logs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('admin_unlink_parent_child', {
              p_child_id: child.id,
              p_parent_id: parent.id,
            });
            if (error) {
              Alert.alert('Could not unlink family member', error.message);
              return;
            }
            await loadParents();
            showToast('Family access removed', 'success');
          },
        },
      ]
    );
  }

  function makePrimaryGuardian(parent) {
    Alert.alert(
      'Make primary guardian?',
      `${parent.full_name} will become the main family contact for ${child.first_name}. The current primary guardian will remain linked.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make primary',
          onPress: async () => {
            setBusyPrimaryId(parent.id);
            const { error } = await supabase.rpc('admin_set_primary_guardian', {
              p_child_id: child.id,
              p_parent_id: parent.id,
            });
            setBusyPrimaryId(null);
            if (error) {
              Alert.alert('Could not change primary guardian', error.message);
              return;
            }
            await loadParents();
            showToast(`${parent.full_name} is now the primary guardian`, 'success');
          },
        },
      ],
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

      <TouchableOpacity
        style={styles.dailyReportAction}
        onPress={() => navigation.navigate('DailyLog', {
          child: {
            ...child,
            first_name: firstName,
            last_name: lastName,
            photo_url: photoUrl,
          },
          date: format(new Date(), 'yyyy-MM-dd'),
        })}
        activeOpacity={0.76}
        accessibilityRole="button"
        accessibilityLabel={`Open today's daily report for ${firstName}`}
      >
        <View style={styles.dailyReportIcon}>
          <Ionicons name="today-outline" size={21} color={colors.primary} />
        </View>
        <View style={styles.dailyReportCopy}>
          <Text style={styles.dailyReportTitle}>Today’s daily report</Text>
          <Text style={styles.dailyReportText}>Log care, activities, notes and approved photos</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </TouchableOpacity>

      <View style={[
        styles.card,
        route.params?.focusSection === 'pickups' && styles.pickupCardFocused,
      ]}>
        <View style={styles.pickupHeader}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} />
            <Text style={styles.cardTitleInline}>Authorized pickups</Text>
          </View>
          {pickupPeople.some((person) => person.approval_status === 'pending') ? (
            <View style={styles.pickupPendingCount}>
              <Text style={styles.pickupPendingCountText}>
                {pickupPeople.filter((person) => person.approval_status === 'pending').length} to review
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.pickupIntro}>
          Parent-added people stay blocked from pickup passes and kiosk credentials until an authorized administrator approves them.
        </Text>

        {loadingPickups ? (
          <ActivityIndicator style={styles.pickupLoader} color={colors.primary} />
        ) : pickupError && pickupPeople.length === 0 ? (
          <View style={styles.pickupLoadError}>
            <Text style={styles.pickupErrorText}>{pickupError}</Text>
            <TouchableOpacity onPress={() => loadPickupPeople()} accessibilityRole="button">
              <Text style={styles.pickupRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : pickupPeople.length === 0 ? (
          <View style={styles.pickupEmpty}>
            <Ionicons name="people-outline" size={22} color={colors.textFaint} />
            <Text style={styles.pickupEmptyText}>No non-account pickup people are listed.</Text>
          </View>
        ) : (
          <View style={styles.pickupList}>
            {pickupPeople.map((person, index) => {
              const pending = person.approval_status === 'pending';
              const approved = person.approval_status === 'approved';
              const focused = route.params?.pickupId === person.id;
              const busy = reviewingPickupId === person.id;
              return (
                <View
                  key={person.id}
                  style={[
                    styles.pickupPersonRow,
                    index > 0 && styles.pickupPersonBorder,
                    focused && styles.pickupPersonFocused,
                  ]}
                >
                  <View style={[
                    styles.pickupPersonAvatar,
                    approved && styles.pickupPersonAvatarApproved,
                    person.approval_status === 'rejected' && styles.pickupPersonAvatarRejected,
                  ]}>
                    <Text style={styles.pickupPersonInitial}>{person.full_name?.[0] || '?'}</Text>
                  </View>
                  <View style={styles.pickupPersonCopy}>
                    <Text style={styles.pickupPersonName}>{person.full_name}</Text>
                    <Text style={styles.pickupPersonMeta}>
                      {person.relationship || 'Authorized pickup'}{person.phone ? ` · ${person.phone}` : ''}
                    </Text>
                    <Text style={[
                      styles.pickupStatus,
                      approved && styles.pickupStatusApproved,
                      person.approval_status === 'rejected' && styles.pickupStatusRejected,
                    ]}>
                      {pending ? 'Awaiting center review' : approved ? 'Approved' : 'Not approved'}
                    </Text>
                    {person.review_note ? <Text style={styles.pickupReviewNote}>{person.review_note}</Text> : null}
                  </View>
                  {pending && canReviewPickups ? (
                    <View style={styles.pickupReviewActions}>
                      {busy ? <ActivityIndicator color={colors.primary} /> : (
                        <>
                          <TouchableOpacity
                            style={styles.pickupApproveButton}
                            onPress={() => approvePickup(person)}
                            accessibilityLabel={`Approve ${person.full_name} for pickup`}
                          >
                            <Ionicons name="checkmark" size={17} color={colors.white} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.pickupRejectButton}
                            onPress={() => openRejectPickup(person)}
                            accessibilityLabel={`Do not approve ${person.full_name} for pickup`}
                          >
                            <Ionicons name="close" size={17} color={colors.danger} />
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  ) : pending ? (
                    <View style={styles.pickupReadOnlyBadge}>
                      <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                    </View>
                  ) : (
                    <Ionicons
                      name={approved ? 'checkmark-circle' : 'close-circle'}
                      size={21}
                      color={approved ? colors.success : colors.danger}
                    />
                  )}
                </View>
              );
            })}
          </View>
        )}
        {pickupError && pickupPeople.length > 0 ? <Text style={styles.pickupErrorText}>{pickupError}</Text> : null}
        {!canReviewPickups && pickupPeople.some((person) => person.approval_status === 'pending') ? (
          <Text style={styles.pickupPermissionNote}>A team member with children-edit permission must review pending pickup people.</Text>
        ) : null}
      </View>

      <Modal
        visible={Boolean(rejectingPickup)}
        transparent
        animationType="slide"
        onRequestClose={() => !reviewingPickupId && setRejectingPickup(null)}
      >
        <View style={styles.moveOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => !reviewingPickupId && setRejectingPickup(null)}
          />
          <View style={styles.pickupRejectSheet}>
            <View style={styles.moveSheetHeader}>
              <Text style={[styles.moveSheetTitle, { flex: 1 }]}>Do not approve pickup</Text>
              <TouchableOpacity onPress={() => setRejectingPickup(null)} disabled={Boolean(reviewingPickupId)} accessibilityLabel="Close">
                <Text style={styles.moveSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.pickupRejectContent}>
              <Text style={styles.pickupRejectTitle}>{rejectingPickup?.full_name}</Text>
              <Text style={styles.pickupRejectText}>
                This person will remain unable to create a pickup pass or use their kiosk PIN. The family will see your note.
              </Text>
              <Input
                label="Note to family (optional)"
                value={reviewNote}
                onChangeText={setReviewNote}
                placeholder="e.g. Please visit the office with photo ID."
                multiline
                maxLength={500}
              />
              <Button
                label="Confirm not approved"
                variant="danger"
                loading={Boolean(reviewingPickupId)}
                onPress={() => submitPickupReview(rejectingPickup, 'rejected', reviewNote.trim() || null)}
              />
            </View>
          </View>
        </View>
      </Modal>

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

      <View style={[styles.card, styles.handoffCard, !handoffReady && styles.handoffCardPending]}>
        <View style={styles.handoffHeader}>
          <View style={[styles.handoffIcon, handoffReady && styles.handoffIconReady]}>
            <Ionicons name={handoffReady ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={21} color={handoffReady ? colors.success : colors.amber} />
          </View>
          <View style={styles.classroomInfo}>
            <Text style={styles.cardTitleCompact}>Room handoff</Text>
            <Text style={styles.handoffStatus}>{handoffReady ? 'First-day setup complete' : 'Setup needs administrator attention'}</Text>
          </View>
        </View>
        <View style={styles.handoffDetails}>
          <View style={styles.handoffDetailRow}><Text style={styles.handoffDetailLabel}>First day</Text><Text style={styles.handoffDetailValue}>{child.enrolled_on ? formatBirthDate(child.enrolled_on) : 'Not recorded'}</Text></View>
          <View style={styles.handoffDetailRow}><Text style={styles.handoffDetailLabel}>Primary educator</Text><Text style={styles.handoffDetailValue}>{isPrimaryEducator ? 'You' : primaryEducatorName || 'Not assigned'}</Text></View>
          <View style={styles.handoffDetailRow}><Text style={styles.handoffDetailLabel}>Cubby</Text><Text style={styles.handoffDetailValue}>{cubbyLabel || 'Not assigned'}</Text></View>
        </View>
        {!handoffReady ? <View style={styles.handoffNotice}><Ionicons name="information-circle-outline" size={17} color={colors.amber} /><Text style={styles.handoffNoticeText}>Ask an administrator to complete the enrollment room handoff. Attendance remains available because the first day has begun.</Text></View> : null}
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

        <TouchableOpacity
          onPress={toggleNoKnownMedicalNeeds}
          disabled={savingMedical}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: noKnownMedicalNeeds, disabled: savingMedical }}
          style={[
            styles.medicalReviewRow,
            noKnownMedicalNeeds && styles.medicalReviewRowSelected,
          ]}
        >
          <Ionicons
            name={noKnownMedicalNeeds ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={noKnownMedicalNeeds ? colors.success : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.medicalReviewTitle}>No known allergies or medical needs</Text>
            <Text style={styles.medicalReviewSub}>Confirm this after reviewing the child’s information with the family.</Text>
          </View>
        </TouchableOpacity>

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
            disabled={!newAllergy.trim() || savingMedical}
            style={[styles.medAddBtn, (!newAllergy.trim() || savingMedical) && styles.medAddBtnDisabled]}
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
          disabled={savingMedical}
          style={[styles.medAddBtn, { alignSelf: 'flex-start', marginTop: spacing.sm }]}
        >
          <Text style={styles.medAddBtnText}>+ Add contact</Text>
        </TouchableOpacity>

        <Divider />

        {/* Medical notes */}
        <Text style={styles.medLabel}>Medical notes</Text>
        <Input
          value={medicalNotes}
          onChangeText={(value) => {
            setMedicalNotes(value);
            if (!medicalReviewed) return;
            if (!child.medical_notes && !allergies.length && !noKnownMedicalNeeds) setMedicalReviewed(false);
          }}
          placeholder="e.g. Carries EpiPen; inhaler in cubby"
          multiline
        />
        <TouchableOpacity
          onPress={() => saveMedical({ medicalNotes, noKnownMedicalNeeds: false })}
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

        {canManageFamilyDocuments ? (
          <>
            <Divider />
            <TouchableOpacity
              onPress={() => navigation.navigate('AdminChildDocuments', { childId: child.id, child: { ...child, first_name: firstName, last_name: lastName } })}
              style={styles.medLink}
              accessibilityRole="button"
              accessibilityLabel={`Open family documents for ${firstName}`}
            >
              <View style={styles.medLinkIcon}>
                <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.medLinkTitle}>Family documents</Text>
                <Text style={styles.medLinkSub}>Requests, secure uploads & review history</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          </>
        ) : null}
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
                  <View style={styles.parentAccessRow}>
                    <View style={styles.parentAccessBadge}>
                      <Text style={styles.parentAccessBadgeText}>{parent.relationship || 'Family'}</Text>
                    </View>
                    {parent.is_primary ? (
                      <View style={styles.parentAccessBadge}><Text style={styles.parentAccessBadgeText}>Primary</Text></View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.parentAccessBadge, styles.makePrimaryBadge]}
                        onPress={() => makePrimaryGuardian(parent)}
                        disabled={busyPrimaryId === parent.id}
                        accessibilityLabel={`Make ${parent.full_name} primary guardian`}
                      >
                        {busyPrimaryId === parent.id
                          ? <ActivityIndicator size="small" color={colors.primary} />
                          : <Text style={styles.makePrimaryBadgeText}>Make primary</Text>}
                      </TouchableOpacity>
                    )}
                    <View style={[styles.parentAccessBadge, parent.pickup_authorized ? styles.parentAccessBadgeOk : styles.parentAccessBadgeMuted]}>
                      <Text style={[styles.parentAccessBadgeText, parent.pickup_authorized ? styles.parentAccessBadgeTextOk : styles.parentAccessBadgeTextMuted]}>
                        {parent.pickup_authorized ? 'Pickup allowed' : 'No pickup'}
                      </Text>
                    </View>
                  </View>
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

        {pendingInvites.length > 0 && (
          <View style={styles.pendingInviteBlock}>
            <View style={styles.pendingInviteHeading}>
              <Ionicons name="time-outline" size={17} color={colors.amber} />
              <Text style={styles.pendingInviteTitle}>Pending family invites</Text>
            </View>
            {pendingInvites.map(invite => {
              const expires = invite.expires_at ? new Date(invite.expires_at) : null;
              const expired = expires && expires.getTime() <= Date.now();
              return (
                <View style={styles.pendingInviteCard} key={invite.id}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.pendingInviteEmail} numberOfLines={1}>{invite.email}</Text>
                    <Text style={[styles.pendingInviteMeta, expired && styles.pendingInviteExpired]}>
                      {invite.relationship || 'Parent'} · {expired ? 'Expired' : expires ? `Expires ${format(expires, 'MMM d')}` : 'No expiry set'}
                    </Text>
                    <Text style={styles.pendingInviteCode}>Code {invite.code}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.inviteIconButton}
                    onPress={() => resendInvite(invite)}
                    disabled={busyInviteId === invite.id}
                    accessibilityLabel={`Resend invite to ${invite.email}`}
                  >
                    {busyInviteId === invite.id
                      ? <ActivityIndicator color={colors.primary} size="small" />
                      : <Ionicons name="refresh-outline" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inviteIconButton, styles.inviteDeleteButton]}
                    onPress={() => cancelInvite(invite)}
                    disabled={busyInviteId === invite.id}
                    accessibilityLabel={`Cancel invite for ${invite.email}`}
                  >
                    <Ionicons name="trash-outline" size={17} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              );
            })}
            <Divider />
          </View>
        )}

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
        <Text style={styles.inviteLabel}>Invite a new family member</Text>
        <Input
          label="Email *"
          value={inviteEmail}
          onChangeText={value => {
            setInviteEmail(value);
            if (inviteErrors.email || inviteErrors.form) setInviteErrors(current => ({ ...current, email: null, form: null }));
          }}
          placeholder="parent@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          error={inviteErrors.email}
        />
        <Input
          label="Relationship *"
          value={inviteRelationship}
          onChangeText={value => {
            setInviteRelationship(value);
            if (inviteErrors.relationship || inviteErrors.form) setInviteErrors(current => ({ ...current, relationship: null, form: null }));
          }}
          placeholder="Parent, guardian, grandmother…"
          autoCapitalize="words"
          error={inviteErrors.relationship}
        />
        {inviteErrors.form ? <Text style={styles.inviteError}>{inviteErrors.form}</Text> : null}
        <TouchableOpacity
          onPress={handleInviteParent}
          disabled={inviting}
          style={[styles.inviteBtn, inviting && styles.inviteBtnDisabled]}
          accessibilityRole="button"
          accessibilityState={{ disabled: inviting, busy: inviting }}
        >
          {inviting
            ? <ActivityIndicator color={colors.white} size="small" />
            : <><Ionicons name="mail-outline" size={17} color={colors.white} /><Text style={styles.inviteBtnText}>Send 7-day invite</Text></>
          }
        </TouchableOpacity>
        <Text style={styles.inviteHint}>
          The code is email-bound, single-use and expires after seven days. Linking completes only after the family signs in and accepts it.
        </Text>
      </View>

      {/* Parent picker modal */}
      <Modal visible={showParentPicker} transparent animationType="slide" onRequestClose={closeParentPicker}>
        <View style={styles.moveOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeParentPicker} />
          <View style={styles.moveSheet}>
            <View style={styles.moveSheetHeader}>
              {selectedExistingParent ? (
                <TouchableOpacity onPress={() => setSelectedExistingParent(null)} style={styles.sheetBack} accessibilityLabel="Back to family list">
                  <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              ) : null}
              <Text style={[styles.moveSheetTitle, { flex: 1 }]}>{selectedExistingParent ? 'Review family access' : 'Link a family member'}</Text>
              <TouchableOpacity onPress={closeParentPicker} accessibilityLabel="Close family picker">
                <Text style={styles.moveSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {selectedExistingParent ? (
              <ScrollView style={styles.moveList} contentContainerStyle={styles.accessReview} keyboardShouldPersistTaps="handled">
                <View style={styles.selectedParentCard}>
                  <View style={[styles.parentAvatar, { width: 44, height: 44, borderRadius: 22 }]}>
                    <Text style={styles.parentInitial}>{selectedExistingParent.full_name?.[0] || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.moveRoomName}>{selectedExistingParent.full_name}</Text>
                    <Text style={styles.moveRoomAge}>{selectedExistingParent.email}</Text>
                  </View>
                </View>
                <Input
                  label="Relationship *"
                  value={existingRelationship}
                  onChangeText={value => { setExistingRelationship(value); if (existingLinkError) setExistingLinkError(''); }}
                  placeholder="Parent, guardian, grandmother…"
                  autoCapitalize="words"
                  error={!existingRelationship.trim() ? existingLinkError : ''}
                />
                <TouchableOpacity
                  style={styles.pickupAccessCard}
                  onPress={() => setExistingPickupAllowed(value => !value)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: existingPickupAllowed }}
                >
                  <View style={[styles.pickupAccessIcon, existingPickupAllowed && styles.pickupAccessIconOn]}>
                    <Ionicons name="key-outline" size={19} color={existingPickupAllowed ? colors.success : colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickupAccessTitle}>Authorized pickup</Text>
                    <Text style={styles.pickupAccessText}>Allow this family member to pick up {firstName}.</Text>
                  </View>
                  <View style={[styles.accessToggle, existingPickupAllowed && styles.accessToggleOn]}>
                    <View style={[styles.accessToggleThumb, existingPickupAllowed && styles.accessToggleThumbOn]} />
                  </View>
                </TouchableOpacity>
                {parents.length === 0 ? (
                  <View style={styles.primaryNotice}>
                    <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                    <Text style={styles.primaryNoticeText}>As the first linked family member, they will be marked primary.</Text>
                  </View>
                ) : null}
                {existingLinkError && existingRelationship.trim() ? <Text style={styles.inviteError}>{existingLinkError}</Text> : null}
                <Button label="Confirm family access" onPress={linkExistingParent} loading={linkingExisting} />
              </ScrollView>
            ) : (
              <ScrollView style={styles.moveList}>
                {existingParents
                  .filter(p => !parents.find(lp => lp.id === p.id))
                  .map(parent => (
                    <TouchableOpacity
                      key={parent.id}
                      onPress={() => selectExistingParent(parent)}
                      style={styles.moveRoomRow}
                      activeOpacity={0.7}
                      accessibilityLabel={`Review access for ${parent.full_name}`}
                    >
                      <View style={[styles.parentAvatar, { width: 36, height: 36, borderRadius: 18 }]}>
                        <Text style={styles.parentInitial}>{parent.full_name?.[0] || '?'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.moveRoomName}>{parent.full_name}</Text>
                        <Text style={styles.moveRoomAge}>{parent.email}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                    </TouchableOpacity>
                  ))}
                {existingParents.filter(p => !parents.find(lp => lp.id === p.id)).length === 0 && (
                  <Text style={[styles.noParents, { padding: spacing.xl, textAlign: 'center' }]}>No other family accounts are available to link.</Text>
                )}
              </ScrollView>
            )}
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
  routeState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.bg },
  routeStateTitle: { marginTop: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, textAlign: 'center' },
  routeStateText: { marginTop: spacing.sm, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
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
  dailyReportAction: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  dailyReportIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  dailyReportCopy: { flex: 1, minWidth: 0 },
  dailyReportTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  dailyReportText: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },

  pickupCardFocused: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  pickupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  pickupPendingCount: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.amberLight },
  pickupPendingCountText: { color: colors.amber, fontFamily: fonts.bold, fontSize: 10.5 },
  pickupIntro: { marginTop: spacing.sm, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17 },
  pickupLoader: { marginVertical: spacing.xl },
  pickupLoadError: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  pickupErrorText: { marginTop: spacing.sm, color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5, lineHeight: 16 },
  pickupRetryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  pickupEmpty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg },
  pickupEmptyText: { flex: 1, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12 },
  pickupList: { marginTop: spacing.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, backgroundColor: colors.surface },
  pickupPersonRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  pickupPersonBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSoft },
  pickupPersonFocused: { backgroundColor: colors.amberLight },
  pickupPersonAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.amberLight },
  pickupPersonAvatarApproved: { backgroundColor: colors.successLight },
  pickupPersonAvatarRejected: { backgroundColor: colors.dangerLight },
  pickupPersonInitial: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  pickupPersonCopy: { flex: 1, minWidth: 0 },
  pickupPersonName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  pickupPersonMeta: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  pickupStatus: { marginTop: 4, color: colors.amber, fontFamily: fonts.bold, fontSize: 10.5 },
  pickupStatusApproved: { color: colors.success },
  pickupStatusRejected: { color: colors.danger },
  pickupReviewNote: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 14 },
  pickupReviewActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickupApproveButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.success },
  pickupRejectButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.danger + '55', borderRadius: radius.md, backgroundColor: colors.dangerLight },
  pickupReadOnlyBadge: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.bg },
  pickupPermissionNote: { marginTop: spacing.md, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 15 },
  pickupRejectSheet: { maxHeight: '70%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface, paddingBottom: spacing.xxxl },
  pickupRejectContent: { padding: spacing.xl },
  pickupRejectTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  pickupRejectText: { marginTop: spacing.xs, marginBottom: spacing.lg, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },

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
  parentAccessRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  parentAccessBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.primaryLight },
  parentAccessBadgeOk: { backgroundColor: colors.successLight },
  parentAccessBadgeMuted: { backgroundColor: colors.bg },
  parentAccessBadgeText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 9.5 },
  parentAccessBadgeTextOk: { color: colors.success },
  parentAccessBadgeTextMuted: { color: colors.textMuted },
  makePrimaryBadge: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  makePrimaryBadgeText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 9.5 },
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
  inviteBtn: {
    flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', minHeight: 46,
  },
  inviteBtnDisabled: { backgroundColor: colors.border },
  inviteBtnText: { fontSize: 14, color: colors.white, fontFamily: fonts.bold },
  inviteHint: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: spacing.sm },
  inviteError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12, marginBottom: spacing.sm },
  pendingInviteBlock: { marginBottom: spacing.md },
  pendingInviteHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  pendingInviteTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  pendingInviteCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.amberLight },
  pendingInviteEmail: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  pendingInviteMeta: { color: colors.amber, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  pendingInviteExpired: { color: colors.danger },
  pendingInviteCode: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 10.5, marginTop: 3, letterSpacing: 0.5 },
  inviteIconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surface },
  inviteDeleteButton: { backgroundColor: colors.dangerLight },

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
  handoffCard: { backgroundColor: colors.successLight, borderColor: colors.success + '33' },
  handoffCardPending: { backgroundColor: colors.amberLight, borderColor: colors.amber + '44' },
  handoffHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  handoffIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.surface },
  handoffIconReady: { backgroundColor: colors.surface },
  handoffStatus: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
  handoffDetails: { marginTop: spacing.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, backgroundColor: colors.surface },
  handoffDetailRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
  handoffDetailLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  handoffDetailValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 11.5, textAlign: 'right' },
  handoffNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  handoffNoticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
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
  sheetBack: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginRight: spacing.xs },
  moveSheetTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  moveSheetClose: { fontSize: 20, color: colors.textSecondary, fontWeight: '600', padding: spacing.xs },
  moveList: { paddingHorizontal: spacing.md },
  moveRoomRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  accessReview: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  selectedParentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.bg },
  pickupAccessCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  pickupAccessIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.bg },
  pickupAccessIconOn: { backgroundColor: colors.successLight },
  pickupAccessTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  pickupAccessText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  accessToggle: { width: 42, height: 24, padding: 3, borderRadius: 12, backgroundColor: colors.border },
  accessToggleOn: { backgroundColor: colors.success },
  accessToggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.white },
  accessToggleThumbOn: { marginLeft: 18 },
  primaryNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  primaryNoticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
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
  medicalReviewRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.primarySoft, padding: spacing.md, marginBottom: spacing.lg,
  },
  medicalReviewRowSelected: { borderColor: colors.success, backgroundColor: colors.successLight },
  medicalReviewTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
  medicalReviewSub: { fontSize: 11, color: colors.textSecondary, lineHeight: 16, marginTop: 2 },
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
