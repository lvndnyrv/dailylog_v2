import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Input, Button } from '../../components/ui';
import { DatePickerField } from '../../components/DatePickerField';
import { colors, spacing, radius } from '../../theme';

const STEPS = ['Daycare', 'Classroom', 'Children'];

function StepIndicator({ current }) {
  return (
    <View style={styles.stepRow}>
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <View style={styles.stepItem}>
            <View style={[styles.stepDot, i <= current && styles.stepDotActive]}>
              {i < current
                ? <Text style={styles.stepCheck}>✓</Text>
                : <Text style={[styles.stepNum, i === current && styles.stepNumActive]}>{i + 1}</Text>
              }
            </View>
            <Text style={[styles.stepLabel, i === current && styles.stepLabelActive]}>{label}</Text>
          </View>
          {i < STEPS.length - 1 && (
            <View style={[styles.stepLine, i < current && styles.stepLineActive]} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── STEP 1: DAYCARE ─────────────────────────────────────────────────────────
function StepDaycare({ onNext }) {
  const [name, setName]       = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone]     = useState('');
  const [saving, setSaving]   = useState(false);

  async function handleNext() {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter the daycare name.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('daycares')
      .insert({ name: name.trim(), address: address.trim(), phone: phone.trim() })
      .select()
      .single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onNext({ daycareId: data.id, daycareName: data.name });
  }

  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepEmoji}>🏫</Text>
      <Text style={styles.stepTitle}>Your daycare</Text>
      <Text style={styles.stepDesc}>Tell us about the daycare centre you work at.</Text>
      <Input label="Daycare name *" value={name} onChangeText={setName} placeholder="e.g. Smart Kid South Newmarket" />
      <Input label="Address" value={address} onChangeText={setAddress} placeholder="e.g. 123 Main St, Newmarket, ON" />
      <Input label="Phone" value={phone} onChangeText={setPhone} placeholder="e.g. 905-555-0100" keyboardType="phone-pad" />
      <Button label="Next →" onPress={handleNext} loading={saving} style={{ marginTop: spacing.sm }} />
    </View>
  );
}

// ─── STEP 2: CLASSROOM ────────────────────────────────────────────────────────
function StepClassroom({ daycareId, onNext, onBack }) {
  const { profile, user, fetchProfile } = useAuth();
  const [name, setName]         = useState('Room 1');
  const [ageGroup, setAgeGroup] = useState('');
  const [saving, setSaving]     = useState(false);

  const AGE_GROUPS = ['Infant', 'Toddler', 'Preschool', 'Junior kindergarten', 'Senior kindergarten'];

  async function handleNext() {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a classroom name.');
      return;
    }
    setSaving(true);

    const { data: classroom, error } = await supabase
      .from('classrooms')
      .insert({ daycare_id: daycareId, name: name.trim(), age_group: ageGroup || null })
      .select()
      .single();

    if (error) { setSaving(false); Alert.alert('Error', error.message); return; }

    // Link educator profile to this daycare and classroom
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ daycare_id: daycareId, classroom_id: classroom.id })
      .eq('id', profile.id);

    if (profileError) { setSaving(false); Alert.alert('Error', profileError.message); return; }

    await fetchProfile(user.id);
    setSaving(false);
    onNext({ classroomId: classroom.id });
  }

  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepEmoji}>🚪</Text>
      <Text style={styles.stepTitle}>Your classroom</Text>
      <Text style={styles.stepDesc}>Name your classroom and select the age group you work with.</Text>

      <Input label="Classroom name *" value={name} onChangeText={setName} placeholder="e.g. Room 1, Butterflies, Blue Room" />

      <Text style={styles.fieldLabel}>Age group</Text>
      <View style={styles.chipRow}>
        {AGE_GROUPS.map(g => (
          <TouchableOpacity
            key={g}
            onPress={() => setAgeGroup(g === ageGroup ? '' : g)}
            style={[styles.chip, ageGroup === g && styles.chipSelected]}
          >
            <Text style={[styles.chipText, ageGroup === g && styles.chipTextSelected]}>{g}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.btnRow}>
        <Button label="← Back" onPress={onBack} variant="ghost" style={{ flex: 1 }} />
        <Button label="Next →" onPress={handleNext} loading={saving} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

// ─── STEP 3: CHILDREN ────────────────────────────────────────────────────────
function ChildRow({ child, index, onChange, onRemove }) {
  return (
    <View style={styles.childRow}>
      <View style={styles.childRowHeader}>
        <Text style={styles.childRowNum}>Child {index + 1}</Text>
        {index > 0 && (
          <TouchableOpacity onPress={onRemove}>
            <Text style={styles.childRowRemove}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
      <Input
        label="First name *"
        value={child.firstName}
        onChangeText={v => onChange({ ...child, firstName: v })}
        placeholder="e.g. Emma"
      />
      <Input
        label="Last name"
        value={child.lastName}
        onChangeText={v => onChange({ ...child, lastName: v })}
        placeholder="e.g. Smith"
      />
      <DatePickerField
        label="Date of birth (optional)"
        value={child.dob}
        onChange={v => onChange({ ...child, dob: v })}
      />
    </View>
  );
}

function StepChildren({ classroomId, onFinish, onBack }) {
  const [children, setChildren] = useState([{ firstName: '', lastName: '', dob: '' }]);
  const [saving, setSaving]     = useState(false);

  function addChild() {
    setChildren(prev => [...prev, { firstName: '', lastName: '', dob: '' }]);
  }

  function updateChild(index, updated) {
    setChildren(prev => prev.map((c, i) => i === index ? updated : c));
  }

  function removeChild(index) {
    setChildren(prev => prev.filter((_, i) => i !== index));
  }

  async function handleFinish() {
    const valid = children.filter(c => c.firstName.trim());
    if (!valid.length) {
      Alert.alert('Required', 'Please add at least one child.');
      return;
    }
    setSaving(true);

    const rows = valid.map(c => ({
      classroom_id: classroomId,
      first_name: c.firstName.trim(),
      last_name: c.lastName.trim(),
      date_of_birth: c.dob || null,
    }));

    const { error } = await supabase.from('children').insert(rows);
    setSaving(false);

    if (error) { Alert.alert('Error', error.message); return; }
    onFinish();
  }

  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepEmoji}>👧</Text>
      <Text style={styles.stepTitle}>Add children</Text>
      <Text style={styles.stepDesc}>Add the children in your classroom. You can always add more later from the Manage screen.</Text>

      {children.map((child, i) => (
        <ChildRow
          key={i}
          index={i}
          child={child}
          onChange={updated => updateChild(i, updated)}
          onRemove={() => removeChild(i)}
        />
      ))}

      <TouchableOpacity style={styles.addChildBtn} onPress={addChild}>
        <Text style={styles.addChildBtnText}>+ Add another child</Text>
      </TouchableOpacity>

      <View style={styles.btnRow}>
        <Button label="← Back" onPress={onBack} variant="ghost" style={{ flex: 1 }} />
        <Button label="All done 🎉" onPress={handleFinish} loading={saving} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

// ─── MAIN ONBOARDING SCREEN ───────────────────────────────────────────────────
export default function OnboardingScreen() {
  const [step, setStep]   = useState(0);
  const [data, setData]   = useState({});

  function handleStep1Done({ daycareId, daycareName }) {
    setData(prev => ({ ...prev, daycareId, daycareName }));
    setStep(1);
  }

  function handleStep2Done({ classroomId }) {
    setData(prev => ({ ...prev, classroomId }));
    setStep(2);
  }

  function handleFinish() {
    // Auth context will re-fetch profile and detect classroom_id is now set
    // which will route away from onboarding automatically
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
        <Text style={styles.logo}>📋</Text>
        <Text style={styles.appName}>DailyLog</Text>
        <Text style={styles.headerSub}>Let's get you set up</Text>
      </View>

      <StepIndicator current={step} />

      {step === 0 && <StepDaycare onNext={handleStep1Done} />}
      {step === 1 && (
        <StepClassroom
          daycareId={data.daycareId}
          onNext={handleStep2Done}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <StepChildren
          classroomId={data.classroomId}
          onFinish={handleFinish}
          onBack={() => setStep(1)}
        />
      )}

      <View style={{ height: spacing.xxxl }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingTop: 60 },

  header: { alignItems: 'center', marginBottom: spacing.xxxl },
  logo: { fontSize: 48, marginBottom: spacing.sm },
  appName: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  headerSub: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs },

  // Step indicator
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xxl },
  stepItem: { alignItems: 'center', gap: spacing.xs },
  stepDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary },
  stepNum: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  stepNumActive: { color: colors.white },
  stepCheck: { fontSize: 14, color: colors.white, fontWeight: '700' },
  stepLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  stepLabelActive: { color: colors.primary, fontWeight: '600' },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border, marginBottom: spacing.lg, marginHorizontal: spacing.xs },
  stepLineActive: { backgroundColor: colors.primary },

  // Step card
  stepCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl, marginBottom: spacing.lg,
  },
  stepEmoji: { fontSize: 40, marginBottom: spacing.md, textAlign: 'center' },
  stepTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  stepDesc: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: spacing.xl },

  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },

  // Children step
  childRow: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  childRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  childRowNum: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  childRowRemove: { fontSize: 13, color: colors.danger, fontWeight: '500' },
  addChildBtn: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  addChildBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
});
