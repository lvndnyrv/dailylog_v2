import React, { useState } from 'react';
import { isAdminRole } from '@dailylog/shared';
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '../../components/KeyboardAwareScrollView';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Button, Input } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

const ROOM_AGE_GROUPS = [
  'Infant · 0–18 months',
  'Toddler · 18 months–3 years',
  'Preschool · 3–4 years',
  'Kindergarten · 4–6 years',
  'Mixed ages',
];

const DEFAULT_ROOMS = [
  { id: 'setup-preschool', name: 'Preschool', age_group: '3–4 years' },
  { id: 'setup-toddler', name: 'Toddler', age_group: '18 months–3 years' },
];

function ProgressHeader({ step, onBack }) {
  return (
    <View style={styles.progressHeader}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel={step === 0 ? 'Exit setup' : 'Previous step'}
      >
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step + 1) * 25}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{step + 1}/4</Text>
    </View>
  );
}

function WizardFrame({ step, onBack, children }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ProgressHeader step={step} onBack={onBack} />
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.wizardContent}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={24}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function WizardTitle({ title, description }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.wizardTitle}>{title}</Text>
      <Text style={styles.wizardDescription}>{description}</Text>
    </View>
  );
}

function BottomActions({ hint, primaryLabel, onPrimary, loading, skipLabel, onSkip }) {
  return (
    <View style={styles.bottomActions}>
      <Text style={styles.nextHint}>{hint}</Text>
      <Button label={primaryLabel} onPress={onPrimary} loading={loading} />
      {skipLabel ? (
        <TouchableOpacity
          onPress={onSkip}
          style={styles.skipButton}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>{skipLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function InlineError({ children }) {
  if (!children) return null;
  return (
    <View style={styles.inlineError}>
      <Ionicons name="warning-outline" size={15} color={colors.danger} />
      <Text style={styles.inlineErrorText}>{children}</Text>
    </View>
  );
}

function CenterNameStep({ value, onChange, onContinue, error, onBack }) {
  return (
    <WizardFrame step={0} onBack={onBack}>
      <WizardTitle
        title="What's your daycare called?"
        description="This is what parents and educators will see everywhere in the app."
      />
      <Input
        value={value}
        onChangeText={onChange}
        placeholder="e.g. Smart Kid South Newmarket"
        autoCapitalize="words"
        autoCorrect={false}
        error={error}
        returnKeyType="next"
        onSubmitEditing={onContinue}
      />
      <BottomActions
        hint="Next: address · classrooms · invite educators"
        primaryLabel="Continue"
        onPrimary={onContinue}
      />
    </WizardFrame>
  );
}

function CenterAddressStep({
  address,
  phone,
  onAddressChange,
  onPhoneChange,
  errors,
  onContinue,
  onBack,
}) {
  return (
    <WizardFrame step={1} onBack={onBack}>
      <WizardTitle
        title="Where can families find you?"
        description="Your center address and a phone number parents can call."
      />
      <Input
        label="Address  (required)"
        value={address}
        onChangeText={onAddressChange}
        placeholder="Street, city, province"
        textContentType="fullStreetAddress"
        autoComplete="street-address"
        error={errors.address}
      />
      <Input
        label="Center phone  (required)"
        value={phone}
        onChangeText={onPhoneChange}
        placeholder="e.g. 905-555-0100"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        error={errors.phone}
        returnKeyType="done"
        onSubmitEditing={onContinue}
      />
      <BottomActions
        hint="Next: classrooms · invite educators"
        primaryLabel="Continue"
        onPrimary={onContinue}
      />
    </WizardFrame>
  );
}

function ClassroomCard({ room, onEdit }) {
  return (
    <TouchableOpacity
      style={styles.roomCard}
      onPress={onEdit}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${room.name} classroom`}
    >
      <View style={styles.roomIcon}>
        <Ionicons name="business-outline" size={19} color={colors.primary} />
      </View>
      <View style={styles.roomCopy}>
        <Text style={styles.roomName}>{room.name}</Text>
        <Text style={styles.roomAge}>{room.age_group || 'Age group not set'}</Text>
      </View>
      <Ionicons name="pencil-outline" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function ClassroomEditor({ visible, room, onClose, onSave, onRemove }) {
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (!visible) return;
    setName(room?.name || '');
    setAgeGroup(room?.age_group || '');
    setError(null);
  }, [room, visible]);

  function save() {
    if (!name.trim()) {
      setError('Please enter a classroom name.');
      return;
    }
    onSave({
      id: room?.id || `setup-${Date.now()}`,
      name: name.trim(),
      age_group: ageGroup,
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.editorScreen}>
        <View style={styles.editorHeader}>
          <TouchableOpacity onPress={onClose} style={styles.editorHeaderAction}>
            <Text style={styles.editorCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.editorTitle}>
            {room ? 'Edit classroom' : 'Add classroom'}
          </Text>
          <TouchableOpacity onPress={save} style={styles.editorHeaderAction}>
            <Text style={styles.editorSave}>Save</Text>
          </TouchableOpacity>
        </View>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.editorContent}
          keyboardShouldPersistTaps="handled"
        >
          <Input
            label="Classroom name"
            value={name}
            onChangeText={(next) => {
              setName(next);
              setError(null);
            }}
            placeholder="e.g. Preschool"
            autoCapitalize="words"
            error={error}
          />
          <Text style={styles.fieldLabel}>Age group</Text>
          <View style={styles.ageOptions}>
            {ROOM_AGE_GROUPS.map((option) => {
              const [, label = option] = option.split(' · ');
              const selected = ageGroup === label;
              return (
                <TouchableOpacity
                  key={option}
                  onPress={() => setAgeGroup(label)}
                  style={[styles.ageOption, selected && styles.ageOptionSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.ageOptionText, selected && styles.ageOptionTextSelected]}>
                    {option}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
          {room ? (
            <TouchableOpacity onPress={onRemove} style={styles.removeRoomButton}>
              <Text style={styles.removeRoomText}>Remove classroom</Text>
            </TouchableOpacity>
          ) : null}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ClassroomsStep({
  rooms,
  onAdd,
  onEdit,
  onContinue,
  onSkip,
  onBack,
  error,
}) {
  return (
    <WizardFrame step={2} onBack={onBack}>
      <WizardTitle
        title="Add your classrooms"
        description="Group children by room or age. You can add or rename these anytime."
      />
      <View style={styles.roomList}>
        {rooms.map((room) => (
          <ClassroomCard key={room.id} room={room} onEdit={() => onEdit(room)} />
        ))}
        <TouchableOpacity
          style={styles.addRoomCard}
          onPress={onAdd}
          accessibilityRole="button"
        >
          <View style={styles.addRoomIcon}>
            <Ionicons name="add" size={17} color={colors.primary} />
          </View>
          <Text style={styles.addRoomText}>Add classroom</Text>
        </TouchableOpacity>
      </View>
      <InlineError>{error}</InlineError>
      <BottomActions
        hint="Next: invite educators"
        primaryLabel="Continue"
        onPrimary={onContinue}
        skipLabel="Skip — add classrooms later"
        onSkip={onSkip}
      />
    </WizardFrame>
  );
}

function initialsFromEmail(email) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase() || '?';
}

function EducatorInvitesStep({
  email,
  emails,
  onEmailChange,
  onAdd,
  onRemove,
  onFinish,
  onSkip,
  onBack,
  emailError,
  finishError,
  loading,
}) {
  return (
    <WizardFrame step={3} onBack={onBack}>
      <WizardTitle
        title="Invite your educators"
        description="They'll get an email to join and set their own password. You can invite more later."
      />
      <Text style={styles.fieldLabel}>Educator email</Text>
      <View style={styles.inviteComposer}>
        <View style={styles.inviteInputWrap}>
          <Input
            value={email}
            onChangeText={onEmailChange}
            placeholder="educator@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="done"
            onSubmitEditing={onAdd}
            style={styles.inviteInput}
          />
        </View>
        <TouchableOpacity
          onPress={onAdd}
          style={styles.addInviteButton}
          accessibilityRole="button"
        >
          <Text style={styles.addInviteText}>Add</Text>
        </TouchableOpacity>
      </View>
      <InlineError>{emailError}</InlineError>

      <View style={styles.inviteList}>
        {emails.map((inviteEmail) => (
          <View key={inviteEmail} style={styles.inviteCard}>
            <View style={styles.inviteAvatar}>
              <Text style={styles.inviteAvatarText}>{initialsFromEmail(inviteEmail)}</Text>
            </View>
            <View style={styles.inviteCopy}>
              <Text style={styles.inviteEmail} numberOfLines={1}>{inviteEmail}</Text>
              <Text style={styles.inviteMeta}>Educator · invite ready</Text>
            </View>
            <TouchableOpacity onPress={() => onRemove(inviteEmail)}>
              <Text style={styles.removeInviteText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <InlineError>{finishError}</InlineError>

      <BottomActions
        hint="You can skip and invite educators from Settings later."
        primaryLabel="Finish setup"
        onPrimary={onFinish}
        loading={loading}
        skipLabel="Skip — invite later"
        onSkip={onSkip}
      />
    </WizardFrame>
  );
}

function SetupComplete({ summary, onDashboard, loading }) {
  return (
    <SafeAreaView style={styles.successScreen}>
      <View style={styles.successContent}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={44} color={colors.success} />
        </View>
        <Text style={styles.successTitle}>You're all set!</Text>
        <Text style={styles.successDescription}>
          {summary.daycare_name} is ready.
          {summary.invite_count
            ? ' Educators you invited will get an email to join.'
            : ' You can invite educators anytime from Settings.'}
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryIcon}>
              <Ionicons name="business-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.summaryText}>
              {summary.classroom_count} {summary.classroom_count === 1 ? 'classroom' : 'classrooms'}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <View style={styles.summaryIcon}>
              <Ionicons name="person-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.summaryText}>
              {summary.invite_count} {summary.invite_count === 1 ? 'educator invited' : 'educators invited'}
            </Text>
          </View>
        </View>

        <Button
          label="Go to dashboard"
          onPress={onDashboard}
          loading={loading}
          style={styles.dashboardButton}
        />
      </View>
    </SafeAreaView>
  );
}

function CenterSetupWizard() {
  const { user, fetchProfile, signOut } = useAuth();
  const registrationCode = user?.user_metadata?.center_registration_code || '';
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [rooms, setRooms] = useState(DEFAULT_ROOMS);
  const [educatorEmail, setEducatorEmail] = useState('');
  const [educatorEmails, setEducatorEmails] = useState([]);
  const [errors, setErrors] = useState({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openingDashboard, setOpeningDashboard] = useState(false);
  const [summary, setSummary] = useState(null);

  function back() {
    if (step > 0) {
      setErrors({});
      setStep((current) => current - 1);
      return;
    }
    Alert.alert(
      'Exit center setup?',
      'Your setup details are not saved yet.',
      [
        { text: 'Keep setting up', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: signOut },
      ]
    );
  }

  function continueName() {
    if (name.trim().length < 2) {
      setErrors({ name: 'Please enter your daycare name.' });
      return;
    }
    setErrors({});
    setStep(1);
  }

  function continueAddress() {
    const nextErrors = {};
    if (!address.trim()) nextErrors.address = 'Please enter your center address.';
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) nextErrors.phone = 'Please enter a valid center phone.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setStep(2);
  }

  function continueRooms() {
    const names = rooms.map((room) => room.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setErrors({ rooms: 'Each classroom needs a unique name.' });
      return;
    }
    setErrors({});
    setStep(3);
  }

  function openRoomEditor(room = null) {
    setEditingRoom(room);
    setEditorOpen(true);
  }

  function saveRoom(room) {
    const duplicate = rooms.some(
      (candidate) => candidate.id !== room.id
        && candidate.name.trim().toLowerCase() === room.name.trim().toLowerCase()
    );
    if (duplicate) {
      setErrors({ rooms: 'Each classroom needs a unique name.' });
      setEditorOpen(false);
      return;
    }
    setRooms((current) => (
      current.some((candidate) => candidate.id === room.id)
        ? current.map((candidate) => candidate.id === room.id ? room : candidate)
        : [...current, room]
    ));
    setErrors({});
    setEditorOpen(false);
  }

  function removeEditingRoom() {
    setRooms((current) => current.filter((room) => room.id !== editingRoom?.id));
    setErrors({});
    setEditorOpen(false);
  }

  function addEducatorEmail() {
    const normalized = educatorEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setErrors((current) => ({
        ...current,
        educatorEmail: 'Please enter a valid educator email.',
      }));
      return;
    }
    if (educatorEmails.includes(normalized)) {
      setErrors((current) => ({
        ...current,
        educatorEmail: 'That educator is already on your invite list.',
      }));
      return;
    }
    setEducatorEmails((current) => [...current, normalized]);
    setEducatorEmail('');
    setErrors((current) => ({ ...current, educatorEmail: null, finish: null }));
  }

  async function finishSetup(invites = educatorEmails) {
    if (!registrationCode) {
      setErrors((current) => ({
        ...current,
        finish: 'Your DailyLog center registration code is missing. Sign out and restart registration with the approved code.',
      }));
      return;
    }
    setSaving(true);
    setErrors((current) => ({ ...current, finish: null }));
    const { data, error } = await supabase.rpc('complete_center_setup', {
      p_center_name: name.trim(),
      p_address: address.trim(),
      p_phone: phone.trim(),
      p_classrooms: rooms.map(({ name: roomName, age_group }) => ({
        name: roomName.trim(),
        age_group: age_group || null,
      })),
      p_educator_emails: invites,
      p_registration_code: registrationCode,
    });
    setSaving(false);

    if (error) {
      setErrors((current) => ({
        ...current,
        finish: error.message || 'Center setup could not be completed.',
      }));
      return;
    }
    setSummary(data);
  }

  async function goToDashboard() {
    setOpeningDashboard(true);
    const { error } = await supabase.auth.updateUser({
      data: {
        setup_center_pending: false,
        center_registration_code: null,
      },
    });
    if (error) {
      setOpeningDashboard(false);
      Alert.alert('Could not open dashboard', error.message);
      return;
    }
    await fetchProfile(user.id);
  }

  if (summary) {
    return (
      <SetupComplete
        summary={summary}
        onDashboard={goToDashboard}
        loading={openingDashboard}
      />
    );
  }

  if (step === 0) {
    return (
      <CenterNameStep
        value={name}
        onChange={(next) => {
          setName(next);
          setErrors({});
        }}
        onContinue={continueName}
        error={errors.name}
        onBack={back}
      />
    );
  }
  if (step === 1) {
    return (
      <CenterAddressStep
        address={address}
        phone={phone}
        onAddressChange={(next) => {
          setAddress(next);
          setErrors((current) => ({ ...current, address: null }));
        }}
        onPhoneChange={(next) => {
          setPhone(next);
          setErrors((current) => ({ ...current, phone: null }));
        }}
        errors={errors}
        onContinue={continueAddress}
        onBack={back}
      />
    );
  }
  if (step === 2) {
    return (
      <>
        <ClassroomsStep
          rooms={rooms}
          onAdd={() => openRoomEditor()}
          onEdit={openRoomEditor}
          onContinue={continueRooms}
          onSkip={() => {
            setRooms([]);
            setErrors({});
            setStep(3);
          }}
          onBack={back}
          error={errors.rooms}
        />
        <ClassroomEditor
          visible={editorOpen}
          room={editingRoom}
          onClose={() => setEditorOpen(false)}
          onSave={saveRoom}
          onRemove={removeEditingRoom}
        />
      </>
    );
  }
  return (
    <EducatorInvitesStep
      email={educatorEmail}
      emails={educatorEmails}
      onEmailChange={(next) => {
        setEducatorEmail(next);
        setErrors((current) => ({ ...current, educatorEmail: null, finish: null }));
      }}
      onAdd={addEducatorEmail}
      onRemove={(inviteEmail) => (
        setEducatorEmails((current) => current.filter((value) => value !== inviteEmail))
      )}
      onFinish={() => finishSetup()}
      onSkip={() => {
        setEducatorEmails([]);
        finishSetup([]);
      }}
      onBack={back}
      emailError={errors.educatorEmail}
      finishError={errors.finish}
      loading={saving}
    />
  );
}

function EducatorRoomPicker({ daycareId, onCreateNew }) {
  const { profile, user, fetchProfile } = useAuth();
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState(null);
  const [selecting, setSelecting] = useState(false);

  React.useEffect(() => {
    let active = true;
    async function load() {
      const { data, error: roomError } = await supabase
        .from('classrooms')
        .select('id, name, age_group')
        .eq('daycare_id', daycareId)
        .is('archived_at', null)
        .order('name');
      if (!active) return;
      setError(roomError?.message || null);
      setRooms(data || []);
    }
    load();
    return () => { active = false; };
  }, [daycareId]);

  async function pickRoom(room) {
    setSelecting(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ classroom_id: room.id })
      .eq('id', profile.id);
    if (!updateError) {
      await supabase.from('educator_classrooms').upsert(
        { educator_id: profile.id, classroom_id: room.id },
        { onConflict: 'educator_id,classroom_id', ignoreDuplicates: true }
      );
      await fetchProfile(user.id);
    } else {
      setError(updateError.message);
    }
    setSelecting(false);
  }

  return (
    <SafeAreaView style={styles.educatorScreen}>
      <KeyboardAwareScrollView contentContainerStyle={styles.educatorContent}>
        <Text style={styles.educatorEmoji}>🚪</Text>
        <Text style={styles.educatorTitle}>Pick your classroom</Text>
        <Text style={styles.educatorDescription}>
          {rooms === null
            ? "Loading your daycare's rooms…"
            : rooms.length
              ? 'Choose the room you work in. You can switch rooms later.'
              : 'No classrooms exist yet. Ask your director to add one, or create it here if you have permission.'}
        </Text>
        {(rooms || []).map((room) => (
          <TouchableOpacity
            key={room.id}
            style={styles.educatorChoice}
            onPress={() => pickRoom(room)}
            disabled={selecting}
          >
            <View style={styles.roomIcon}>
              <Ionicons name="business-outline" size={19} color={colors.primary} />
            </View>
            <View style={styles.roomCopy}>
              <Text style={styles.roomName}>{room.name}</Text>
              {room.age_group ? <Text style={styles.roomAge}>{room.age_group}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        ))}
        <InlineError>{error}</InlineError>
        {!rooms?.length ? (
          <Button
            label="Create a classroom"
            variant="ghost"
            onPress={onCreateNew}
            style={styles.educatorAction}
          />
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function EducatorRoomCreator({ daycareId, onBack }) {
  const { profile, user, fetchProfile } = useAuth();
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError('Enter a classroom name.');
      return;
    }
    setSaving(true);
    const { data: room, error: roomError } = await supabase
      .from('classrooms')
      .insert({
        daycare_id: daycareId,
        name: name.trim(),
        age_group: ageGroup || null,
      })
      .select('id')
      .single();
    if (roomError) {
      setSaving(false);
      setError(roomError.message);
      return;
    }
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ classroom_id: room.id })
      .eq('id', profile.id);
    if (!profileError) {
      await supabase.from('educator_classrooms').upsert(
        { educator_id: profile.id, classroom_id: room.id },
        { onConflict: 'educator_id,classroom_id', ignoreDuplicates: true }
      );
      await fetchProfile(user.id);
    } else {
      setError(profileError.message);
    }
    setSaving(false);
  }

  return (
    <SafeAreaView style={styles.educatorScreen}>
      <KeyboardAwareScrollView contentContainerStyle={styles.educatorContent}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.educatorTitle}>Create a classroom</Text>
        <Text style={styles.educatorDescription}>
          Add the first room for your center.
        </Text>
        <Input
          label="Classroom name"
          value={name}
          onChangeText={(next) => {
            setName(next);
            setError(null);
          }}
          placeholder="e.g. Preschool"
          error={error}
        />
        <Input
          label="Age group (optional)"
          value={ageGroup}
          onChangeText={setAgeGroup}
          placeholder="e.g. 3–4 years"
        />
        <Button label="Create classroom" onPress={save} loading={saving} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function LegacyEducatorJoin({ onJoined }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);

  async function join() {
    if (!code.trim()) {
      setError('Enter the code from your daycare admin.');
      return;
    }
    setJoining(true);
    setError(null);
    const { data, error: joinError } = await supabase.rpc('join_daycare_with_code', {
      p_code: code.trim(),
    });
    setJoining(false);
    if (joinError) {
      setError(joinError.message);
      return;
    }
    if (!data) {
      setError('Invalid invite code.');
      return;
    }
    onJoined(data);
  }

  return (
    <SafeAreaView style={styles.educatorScreen}>
      <KeyboardAwareScrollView contentContainerStyle={styles.educatorContent}>
        <Text style={styles.educatorEmoji}>🔑</Text>
        <Text style={styles.educatorTitle}>Connect to your daycare</Text>
        <Text style={styles.educatorDescription}>
          Ask your daycare administrator for its connection code. They will manage your permanent room assignments and coverage.
        </Text>
        <Input
          label="Daycare code"
          value={code}
          onChangeText={(next) => {
            setCode(next.toUpperCase());
            setError(null);
          }}
          placeholder="e.g. K7PM3Q"
          error={error}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Button label="Connect" onPress={join} loading={joining} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export default function OnboardingScreen() {
  const { profile, user, fetchProfile } = useAuth();
  const centerSetupPending = user?.user_metadata?.setup_center_pending === true;
  const isCenterSetup = isAdminRole(profile?.role) || centerSetupPending;
  const [educatorDaycareId, setEducatorDaycareId] = useState(profile?.daycare_id || null);
  const [educatorView, setEducatorView] = useState('pick');

  if (isCenterSetup) return <CenterSetupWizard />;
  if (!educatorDaycareId) {
    return <LegacyEducatorJoin onJoined={async () => {
      if (user?.id) await fetchProfile(user.id);
    }} />;
  }
  if (educatorView === 'create') {
    return (
      <EducatorRoomCreator
        daycareId={educatorDaycareId}
        onBack={() => setEducatorView('pick')}
      />
    );
  }
  return (
    <EducatorRoomPicker
      daycareId={educatorDaycareId}
      onCreateNew={() => setEducatorView('create')}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  progressHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 34,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: '#E3EDFA',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  progressLabel: {
    width: 28,
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 13,
    textAlign: 'right',
  },
  wizardContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 28,
  },
  titleBlock: {
    marginBottom: 22,
  },
  wizardTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.4,
  },
  wizardDescription: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  bottomActions: {
    gap: 14,
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  nextHint: {
    color: colors.textFaint,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
  },
  skipButton: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: colors.textMuted,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  inlineErrorText: {
    flex: 1,
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  roomList: {
    gap: 10,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  roomIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  roomCopy: {
    flex: 1,
    minWidth: 0,
  },
  roomName: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  roomAge: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    marginTop: 2,
  },
  addRoomCard: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 16,
  },
  addRoomIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.8,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRoomText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 14.5,
  },
  editorScreen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  editorHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
  editorHeaderAction: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorCancel: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  editorTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  editorSave: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  editorContent: {
    padding: spacing.xxl,
  },
  fieldLabel: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 13.5,
    marginBottom: spacing.sm,
  },
  ageOptions: {
    gap: spacing.sm,
  },
  ageOption: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  ageOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  ageOptionText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  ageOptionTextSelected: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  removeRoomButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: radius.md,
  },
  removeRoomText: {
    color: colors.danger,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  inviteComposer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  inviteInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  inviteInput: {
    marginBottom: 0,
  },
  addInviteButton: {
    minWidth: 72,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  addInviteText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  inviteList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  inviteAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  inviteAvatarText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 12.5,
  },
  inviteCopy: {
    flex: 1,
    minWidth: 0,
  },
  inviteEmail: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 13.5,
  },
  inviteMeta: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 2,
  },
  removeInviteText: {
    color: colors.textFaint,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  successScreen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  successContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 54,
    paddingBottom: 30,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
  },
  successTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 26,
    lineHeight: 33,
    marginTop: 22,
  },
  successDescription: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  summaryCard: {
    width: '100%',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    marginTop: 26,
  },
  summaryRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  summaryText: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: 14.5,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  dashboardButton: {
    width: '100%',
    marginTop: 'auto',
  },
  educatorScreen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  educatorContent: {
    flexGrow: 1,
    padding: spacing.xxl,
    paddingTop: 48,
  },
  educatorEmoji: {
    fontSize: 44,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  educatorTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.black,
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
  },
  educatorDescription: {
    color: colors.textMuted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  educatorChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  educatorAction: {
    marginTop: spacing.lg,
  },
});
