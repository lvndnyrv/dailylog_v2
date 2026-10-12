import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';

import { LoadingScreen } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function relation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function dateLabel(value) {
  if (!value) return 'Not provided';
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'MMM d, yyyy');
}

function activityPresentation(event, familyName) {
  const childName = event.child_name || 'this child';
  const actorName = event.actor_name || 'Center staff';
  const labels = {
    family_guardian_linked: {
      icon: 'person-add-outline',
      title: 'Family access connected',
      detail: `${actorName} linked ${familyName} to ${childName}.`,
    },
    family_invite_accepted: {
      icon: 'mail-open-outline',
      title: 'Family invitation accepted',
      detail: `${familyName} accepted access to ${childName}.`,
    },
    family_relationship_changed: {
      icon: 'people-outline',
      title: 'Relationship updated',
      detail: `${actorName} corrected the family relationship for ${childName}.`,
    },
    family_profile_updated: {
      icon: 'create-outline',
      title: 'Contact details updated',
      detail: `${actorName} corrected this family profile.`,
    },
    family_pickup_authorized: {
      icon: 'key-outline',
      title: 'Pickup access granted',
      detail: `${actorName} authorized ${familyName} to pick up ${childName}.`,
    },
    family_pickup_revoked: {
      icon: 'key-outline',
      title: 'Pickup access removed',
      detail: `${actorName} removed pickup access for ${childName}.`,
    },
    family_primary_guardian_changed: {
      icon: 'star-outline',
      title: 'Primary guardian updated',
      detail: `${actorName} changed the main family contact for ${childName}.`,
    },
    family_guardian_unlinked: {
      icon: 'person-remove-outline',
      title: 'Family access removed',
      detail: `${actorName} unlinked ${familyName} from ${childName}.`,
    },
  };
  return labels[event.action] || {
    icon: 'shield-checkmark-outline',
    title: 'Family access updated',
    detail: `${actorName} updated access for ${childName}.`,
  };
}

function activityDate(value) {
  if (!value) return '';
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? '' : format(parsed, 'MMM d · h:mm a');
}

function InfoRow({ icon, label, value, onPress }) {
  const content = (
    <>
      <View style={styles.infoIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, onPress && styles.infoLink]} numberOfLines={2}>{value || 'Not provided'}</Text>
      </View>
      {onPress ? <Ionicons name="open-outline" size={17} color={colors.textFaint} /> : null}
    </>
  );
  return onPress ? (
    <TouchableOpacity style={styles.infoRow} onPress={onPress} activeOpacity={0.72}>{content}</TouchableOpacity>
  ) : <View style={styles.infoRow}>{content}</View>;
}

function StatusPill({ label, tone = 'neutral' }) {
  const palette = tone === 'success'
    ? { bg: colors.successLight, fg: colors.success }
    : tone === 'warning'
      ? { bg: colors.amberLight, fg: colors.amber }
      : { bg: colors.primaryLight, fg: colors.primary };
  return <View style={[styles.pill, { backgroundColor: palette.bg }]}><Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text></View>;
}

export default function AdminFamilyProfileScreen({ navigation, route }) {
  const initialPerson = route.params?.person;
  const [person, setPerson] = useState(initialPerson || null);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState([]);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const [busyChildId, setBusyChildId] = useState(null);
  const [busyPrimaryChildId, setBusyPrimaryChildId] = useState(null);
  const [editingRelationship, setEditingRelationship] = useState(null);
  const [relationshipDraft, setRelationshipDraft] = useState('');
  const [relationshipError, setRelationshipError] = useState('');
  const [savingRelationship, setSavingRelationship] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({ fullName: '', phone: '', language: '' });
  const [contactErrors, setContactErrors] = useState({});
  const [savingContact, setSavingContact] = useState(false);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!initialPerson?.id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const [profileRes, linkRes, activityRes] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, display_name, email, phone, role, avatar_url, preferred_language, created_at, archived_at')
        .eq('id', initialPerson.id).maybeSingle(),
      supabase.from('parent_children')
        .select(`
          child_id, relationship, pickup_authorized, is_primary,
          consent_given_at, consent_declined_at, consent_version, created_at,
          child:children(
            id, first_name, last_name, preferred_name, photo_url,
            date_of_birth, classroom_id, allergies, medical_notes,
            classroom:classrooms(id, name)
          )
        `)
        .eq('parent_id', initialPerson.id)
        .order('created_at'),
      supabase.rpc('admin_list_family_access_activity', {
        p_parent_id: initialPerson.id,
        p_limit: 20,
      }),
    ]);
    const queryError = profileRes.error || linkRes.error;
    if (queryError) {
      setError(queryError.message);
    } else {
      setPerson(profileRes.data || initialPerson);
      setLinks((linkRes.data || []).map(link => ({ ...link, child: relation(link.child) })));
    }
    setActivity(activityRes.data || []);
    setActivityUnavailable(Boolean(activityRes.error));
    setLoading(false);
    setRefreshing(false);
  }, [initialPerson?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const summary = useMemo(() => ({
    children: links.length,
    pickup: links.filter(link => link.pickup_authorized).length,
    consent: links.filter(link => link.consent_given_at && !link.consent_declined_at).length,
  }), [links]);

  function openUrl(url, fallbackMessage) {
    Linking.openURL(url).catch(() => Alert.alert('Could not open', fallbackMessage));
  }

  function togglePickup(link) {
    const child = link.child;
    const next = !link.pickup_authorized;
    Alert.alert(
      next ? 'Authorize pickup?' : 'Remove pickup access?',
      `${person?.full_name || 'This family member'} will ${next ? '' : 'no longer '}be allowed to pick up ${child?.preferred_name || child?.first_name || 'this child'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Authorize' : 'Remove access',
          style: next ? 'default' : 'destructive',
          onPress: async () => {
            setBusyChildId(link.child_id);
            const { error: updateError } = await supabase.rpc('admin_set_pickup_authorization', {
              p_child_id: link.child_id,
              p_parent_id: person.id,
              p_authorized: next,
            });
            setBusyChildId(null);
            if (updateError) {
              Alert.alert('Could not update pickup access', updateError.message);
              return;
            }
            showToast(next ? 'Pickup access authorized' : 'Pickup access removed', 'success');
            load({ refresh: true });
          },
        },
      ],
    );
  }

  function makePrimaryGuardian(link) {
    const childName = link.child?.preferred_name || link.child?.first_name || 'this child';
    Alert.alert(
      'Make primary guardian?',
      `${person?.full_name || 'This family member'} will become the main family contact for ${childName}. The current primary guardian will remain linked.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make primary',
          onPress: async () => {
            setBusyPrimaryChildId(link.child_id);
            const { error: updateError } = await supabase.rpc('admin_set_primary_guardian', {
              p_child_id: link.child_id,
              p_parent_id: person.id,
            });
            setBusyPrimaryChildId(null);
            if (updateError) {
              Alert.alert('Could not change primary guardian', updateError.message);
              return;
            }
            showToast(`${person.full_name} is now the primary guardian`, 'success');
            load({ refresh: true });
          },
        },
      ],
    );
  }

  function openRelationshipEditor(link) {
    setEditingRelationship(link);
    setRelationshipDraft(link.relationship || 'Parent');
    setRelationshipError('');
  }

  function closeRelationshipEditor() {
    if (savingRelationship) return;
    setEditingRelationship(null);
    setRelationshipDraft('');
    setRelationshipError('');
  }

  async function saveRelationship() {
    const nextRelationship = relationshipDraft.trim();
    if (!nextRelationship) {
      setRelationshipError('Relationship is required.');
      return;
    }
    if (nextRelationship.length > 80) {
      setRelationshipError('Use 80 characters or fewer.');
      return;
    }
    setSavingRelationship(true);
    const { error: updateError } = await supabase.rpc('admin_update_guardian_relationship', {
      p_child_id: editingRelationship.child_id,
      p_parent_id: person.id,
      p_relationship: nextRelationship,
    });
    setSavingRelationship(false);
    if (updateError) {
      setRelationshipError(updateError.message);
      return;
    }
    closeRelationshipEditor();
    showToast('Family relationship updated', 'success');
    load({ refresh: true });
  }

  function openContactEditor() {
    setContactDraft({
      fullName: person?.full_name || '',
      phone: person?.phone || '',
      language: person?.preferred_language || 'English',
    });
    setContactErrors({});
    setEditingContact(true);
  }

  function closeContactEditor() {
    if (savingContact) return;
    setEditingContact(false);
    setContactErrors({});
  }

  async function saveContact() {
    const fullName = contactDraft.fullName.trim();
    const phone = contactDraft.phone.trim();
    const language = contactDraft.language.trim();
    const nextErrors = {};
    if (!fullName) nextErrors.fullName = 'Full name is required.';
    else if (fullName.length > 120) nextErrors.fullName = 'Use 120 characters or fewer.';
    if (phone.length > 40) nextErrors.phone = 'Use 40 characters or fewer.';
    if (!language) nextErrors.language = 'Preferred language is required.';
    else if (language.length > 40) nextErrors.language = 'Use 40 characters or fewer.';
    if (Object.keys(nextErrors).length) {
      setContactErrors(nextErrors);
      return;
    }

    setSavingContact(true);
    const { error: updateError } = await supabase.rpc('admin_update_family_profile', {
      p_parent_id: person.id,
      p_full_name: fullName,
      p_phone: phone || null,
      p_preferred_language: language,
    });
    setSavingContact(false);
    if (updateError) {
      setContactErrors({ form: updateError.message });
      return;
    }
    closeContactEditor();
    showToast('Family contact details updated', 'success');
    load({ refresh: true });
  }

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Back to people">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>FAMILY ACCOUNT</Text>
          <Text style={styles.headerTitle}>Family profile</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
      >
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => load()}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.heroCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(person?.full_name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.personName}>{person?.full_name || 'Family member'}</Text>
            <Text style={styles.personMeta}>{links.length ? `${links.length} linked child${links.length === 1 ? '' : 'ren'}` : 'No linked children'}</Text>
          </View>
          <StatusPill label={person?.archived_at ? 'Archived' : 'Active'} tone={person?.archived_at ? 'warning' : 'success'} />
        </View>

        <View style={styles.summaryRow}>
          {[
            [summary.children, 'Children', 'people-outline'],
            [summary.pickup, 'Pickup access', 'key-outline'],
            [summary.consent, 'Consented', 'shield-checkmark-outline'],
          ].map(([value, label, icon]) => (
            <View style={styles.summaryCard} key={label}>
              <Ionicons name={icon} size={18} color={colors.primary} />
              <Text style={styles.summaryValue}>{value}</Text>
              <Text style={styles.summaryLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.titleActionRow}>
          <Text style={[styles.sectionTitle, styles.actionTitle]}>Contact</Text>
          <TouchableOpacity style={styles.editContactButton} onPress={openContactEditor} accessibilityLabel="Edit family contact details">
            <Ionicons name="create-outline" size={15} color={colors.primary} />
            <Text style={styles.editContactText}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          <InfoRow icon="mail-outline" label="Email" value={person?.email} onPress={person?.email ? () => openUrl(`mailto:${person.email}`, 'Email is not available on this device.') : null} />
          <View style={styles.divider} />
          <InfoRow icon="call-outline" label="Phone" value={person?.phone} onPress={person?.phone ? () => openUrl(`tel:${person.phone}`, 'Calling is not available on this device.') : null} />
          <View style={styles.divider} />
          <InfoRow icon="language-outline" label="Preferred language" value={person?.preferred_language || 'English'} />
          <View style={styles.divider} />
          <InfoRow icon="calendar-outline" label="Account connected" value={dateLabel(person?.created_at)} />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Linked children</Text>
          <Text style={styles.sectionHint}>Family access is managed per child</Text>
        </View>
        {!links.length ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Ionicons name="people-outline" size={24} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>No child is linked</Text>
            <Text style={styles.emptyBody}>Open the child record from the Children tab to connect this family member.</Text>
          </View>
        ) : links.map(link => {
          const child = link.child;
          const childName = child ? `${child.preferred_name || child.first_name} ${child.last_name || ''}`.trim() : 'Child record unavailable';
          const classroom = relation(child?.classroom);
          const consented = Boolean(link.consent_given_at && !link.consent_declined_at);
          return (
            <View style={styles.childCard} key={link.child_id}>
              <TouchableOpacity
                style={styles.childTop}
                onPress={() => child && navigation.navigate('ChildProfile', { child })}
                disabled={!child}
                activeOpacity={0.72}
                accessibilityLabel={`Open ${childName}'s profile`}
              >
                <View style={styles.childAvatar}><Text style={styles.childInitials}>{initials(childName)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>{childName}</Text>
                  <Text style={styles.childMeta}>{classroom?.name || 'No classroom'} · {link.relationship || 'Family'}</Text>
                </View>
                {link.is_primary ? <StatusPill label="Primary" /> : null}
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </TouchableOpacity>

              {!link.is_primary ? (
                <View style={styles.permissionRow}>
                  <View style={styles.permissionText}>
                    <Ionicons name="star-outline" size={17} color={colors.primary} />
                    <View>
                      <Text style={styles.permissionLabel}>Primary guardian</Text>
                      <Text style={styles.permissionHint}>Main family contact for this child</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.permissionButton}
                    onPress={() => makePrimaryGuardian(link)}
                    disabled={busyPrimaryChildId === link.child_id}
                    accessibilityLabel={`Make ${person?.full_name} primary guardian for ${childName}`}
                  >
                    {busyPrimaryChildId === link.child_id
                      ? <Text style={styles.permissionButtonText}>Updating…</Text>
                      : <Text style={styles.permissionButtonText}>Make primary</Text>}
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.permissionRow}>
                <View style={styles.permissionText}>
                  <Ionicons name="people-outline" size={17} color={colors.primary} />
                  <View>
                    <Text style={styles.permissionLabel}>Relationship</Text>
                    <Text style={styles.permissionHint}>{link.relationship || 'Family member'}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.permissionButton}
                  onPress={() => openRelationshipEditor(link)}
                  accessibilityLabel={`Edit ${person?.full_name}'s relationship to ${childName}`}
                >
                  <Text style={styles.permissionButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.permissionRow}>
                <View style={styles.permissionText}>
                  <Ionicons name="key-outline" size={17} color={link.pickup_authorized ? colors.success : colors.textFaint} />
                  <Text style={styles.permissionLabel}>Pickup authorized</Text>
                </View>
                <TouchableOpacity
                  style={[styles.permissionButton, link.pickup_authorized && styles.permissionButtonOn]}
                  onPress={() => togglePickup(link)}
                  disabled={busyChildId === link.child_id}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: link.pickup_authorized, disabled: busyChildId === link.child_id }}
                >
                  <Text style={[styles.permissionButtonText, link.pickup_authorized && styles.permissionButtonTextOn]}>{link.pickup_authorized ? 'Allowed' : 'Not allowed'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.consentRow}>
                <Ionicons name={consented ? 'shield-checkmark' : 'shield-outline'} size={17} color={consented ? colors.success : colors.amber} />
                <Text style={styles.consentText}>{consented ? `Consent recorded${link.consent_version ? ` · ${link.consent_version}` : ''}` : link.consent_declined_at ? 'Consent declined' : 'Consent not recorded'}</Text>
              </View>

              <TouchableOpacity
                style={styles.messageButton}
                onPress={() => navigation.navigate('Messaging', { childId: link.child_id, childName })}
                accessibilityLabel={`Message ${childName}'s family`}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                <Text style={styles.messageButtonText}>Open family conversation</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Access activity</Text>
          <Text style={styles.sectionHint}>Recent administrator changes</Text>
        </View>
        {activityUnavailable ? (
          <View style={styles.activityEmpty}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textFaint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.activityEmptyTitle}>Audit history is restricted</Text>
              <Text style={styles.activityEmptyText}>An administrator with report access can review these changes.</Text>
            </View>
          </View>
        ) : !activity.length ? (
          <View style={styles.activityEmpty}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.activityEmptyTitle}>No access changes yet</Text>
              <Text style={styles.activityEmptyText}>Link, pickup, primary guardian and unlink changes will appear here.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {activity.map((event, index) => {
              const presentation = activityPresentation(event, person?.full_name || 'this family member');
              return (
                <View key={event.event_id}>
                  <View style={styles.activityRow}>
                    <View style={styles.activityIcon}>
                      <Ionicons name={presentation.icon} size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.activityTitleRow}>
                        <Text style={styles.activityTitle}>{presentation.title}</Text>
                        <Text style={styles.activityWhen}>{activityDate(event.occurred_at)}</Text>
                      </View>
                      <Text style={styles.activityDetail}>{presentation.detail}</Text>
                    </View>
                  </View>
                  {index < activity.length - 1 ? <View style={styles.activityDivider} /> : null}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.noteText}>Changing family identity, sign-in access, or child links requires an audited admin workflow. Routine profile taps no longer expose role changes.</Text>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(editingRelationship)}
        transparent
        animationType="slide"
        onRequestClose={closeRelationshipEditor}
      >
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={closeRelationshipEditor} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Edit relationship</Text>
                <Text style={styles.sheetSubtitle}>
                  How {person?.full_name || 'this family member'} is related to {editingRelationship?.child?.preferred_name || editingRelationship?.child?.first_name || 'this child'}.
                </Text>
              </View>
              <TouchableOpacity style={styles.sheetClose} onPress={closeRelationshipEditor} accessibilityLabel="Close relationship editor">
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Relationship <Text style={styles.required}>*</Text></Text>
            <TextInput
              value={relationshipDraft}
              onChangeText={value => { setRelationshipDraft(value); if (relationshipError) setRelationshipError(''); }}
              placeholder="Parent, guardian, grandmother…"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="words"
              maxLength={80}
              style={[styles.relationshipInput, relationshipError && styles.relationshipInputError]}
              accessibilityLabel="Relationship required"
            />
            {relationshipError ? <Text style={styles.relationshipError}>{relationshipError}</Text> : null}
            <TouchableOpacity
              style={[styles.saveRelationshipButton, savingRelationship && styles.disabledButton]}
              onPress={saveRelationship}
              disabled={savingRelationship}
              accessibilityLabel="Save family relationship"
            >
              {savingRelationship
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.saveRelationshipText}>Save relationship</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={editingContact}
        transparent
        animationType="slide"
        onRequestClose={closeContactEditor}
      >
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={closeContactEditor} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Edit family contact</Text>
                <Text style={styles.sheetSubtitle}>Correct contact details used by center staff. Sign-in email stays protected.</Text>
              </View>
              <TouchableOpacity style={styles.sheetClose} onPress={closeContactEditor} accessibilityLabel="Close family contact editor">
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Full name <Text style={styles.required}>*</Text></Text>
            <TextInput
              value={contactDraft.fullName}
              onChangeText={value => { setContactDraft(draft => ({ ...draft, fullName: value })); setContactErrors(errors => ({ ...errors, fullName: '', form: '' })); }}
              placeholder="Full name"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="words"
              maxLength={120}
              style={[styles.relationshipInput, contactErrors.fullName && styles.relationshipInputError]}
              accessibilityLabel="Family full name required"
            />
            {contactErrors.fullName ? <Text style={styles.relationshipError}>{contactErrors.fullName}</Text> : null}

            <Text style={[styles.fieldLabel, styles.nextField]}>Phone</Text>
            <TextInput
              value={contactDraft.phone}
              onChangeText={value => { setContactDraft(draft => ({ ...draft, phone: value })); setContactErrors(errors => ({ ...errors, phone: '', form: '' })); }}
              placeholder="Optional phone number"
              placeholderTextColor={colors.textFaint}
              keyboardType="phone-pad"
              maxLength={40}
              style={[styles.relationshipInput, contactErrors.phone && styles.relationshipInputError]}
              accessibilityLabel="Family phone number optional"
            />
            {contactErrors.phone ? <Text style={styles.relationshipError}>{contactErrors.phone}</Text> : null}

            <Text style={[styles.fieldLabel, styles.nextField]}>Preferred language <Text style={styles.required}>*</Text></Text>
            <TextInput
              value={contactDraft.language}
              onChangeText={value => { setContactDraft(draft => ({ ...draft, language: value })); setContactErrors(errors => ({ ...errors, language: '', form: '' })); }}
              placeholder="e.g. English"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="words"
              maxLength={40}
              style={[styles.relationshipInput, contactErrors.language && styles.relationshipInputError]}
              accessibilityLabel="Preferred language required"
            />
            {contactErrors.language ? <Text style={styles.relationshipError}>{contactErrors.language}</Text> : null}
            {contactErrors.form ? <Text style={styles.relationshipError}>{contactErrors.form}</Text> : null}

            <TouchableOpacity
              style={[styles.saveRelationshipButton, savingContact && styles.disabledButton]}
              onPress={saveContact}
              disabled={savingContact}
              accessibilityLabel="Save family contact details"
            >
              {savingContact
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.saveRelationshipText}>Save contact details</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  backButton: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.4 },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 22, marginTop: 2 },
  content: { padding: spacing.lg, paddingBottom: 44 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.dangerLight, padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.md },
  errorText: { flex: 1, color: colors.danger, fontFamily: fonts.regular, fontSize: 13 },
  retryText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13 },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.amberLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.amber, fontFamily: fonts.black, fontSize: 19 },
  personName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  personMeta: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  pill: { borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  pillText: { fontFamily: fonts.bold, fontSize: 11 },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  summaryCard: { flex: 1, minHeight: 92, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  summaryValue: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20, marginTop: 4 },
  summaryLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10, textAlign: 'center', marginTop: 2 },
  sectionHeader: { marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 17, marginTop: spacing.xl, marginBottom: spacing.sm },
  titleActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  actionTitle: { marginTop: 0, marginBottom: 0 },
  editContactButton: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.full, backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 7 },
  editContactText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  sectionHint: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12, marginTop: -4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  infoIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  infoLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 },
  infoValue: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14, marginTop: 2 },
  infoLink: { color: colors.primary },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginLeft: 59 },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xxl },
  emptyIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16, marginTop: spacing.md },
  emptyBody: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: spacing.xs },
  childCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  childTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  childAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  childInitials: { color: colors.primary, fontFamily: fonts.black, fontSize: 14 },
  childName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
  childMeta: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  permissionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  permissionText: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  permissionLabel: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 13 },
  permissionHint: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 10.5, marginTop: 2 },
  permissionButton: { backgroundColor: colors.bg, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, paddingVertical: 6 },
  permissionButtonOn: { backgroundColor: colors.successLight, borderColor: colors.successLight },
  permissionButtonText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11 },
  permissionButtonTextOn: { color: colors.success },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  consentText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12 },
  messageButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, marginTop: spacing.md, paddingVertical: 11 },
  messageButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  activityEmpty: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  activityEmptyTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  activityEmptyText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md },
  activityIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  activityTitleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  activityTitle: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  activityWhen: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 10 },
  activityDetail: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 3 },
  activityDivider: { height: 1, backgroundColor: colors.borderSoft, marginLeft: 58 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  noteText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,38,72,0.38)' },
  sheetDismiss: { flex: 1 },
  sheet: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 38, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  sheetTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 22 },
  sheetSubtitle: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  sheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.bg },
  fieldLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13, marginBottom: 7 },
  nextField: { marginTop: spacing.md },
  required: { color: colors.danger },
  relationshipInput: { minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16 },
  relationshipInputError: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  relationshipError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12, marginTop: spacing.xs },
  saveRelationshipButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xl },
  saveRelationshipText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  disabledButton: { opacity: 0.55 },
});
