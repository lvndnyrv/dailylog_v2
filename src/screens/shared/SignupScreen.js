import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { Input, Button } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function SignupScreen({ navigation }) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone]       = useState('');
  const [role, setRole]         = useState('parent');
  const [loading, setLoading]   = useState(false);

  const isParent = role === 'parent';

  async function handleSignup() {
    if (!fullName || !email || !password) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (isParent && !phone.trim()) {
      Alert.alert('Phone required', 'Parents must provide a phone number so educators can reach you in an emergency.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = await signUp(
      email.trim().toLowerCase(),
      password,
      fullName.trim(),
      role,
      phone.trim()
    );
    setLoading(false);
    if (error) Alert.alert('Sign up failed', error.message);
  }

  const roles = [
    { key: 'parent',   label: '👨‍👩‍👧 Parent',   desc: "View your child's daily log" },
    { key: 'educator', label: '👩‍🏫 Educator', desc: 'Fill in daily logs for your classroom' },
  ];

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      extraScrollHeight={20}
    >
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create account</Text>

        <Text style={styles.roleLabel}>I am a...</Text>
        <View style={styles.roleRow}>
          {roles.map(r => (
            <TouchableOpacity
              key={r.key}
              onPress={() => setRole(r.key)}
              style={[styles.roleCard, role === r.key && styles.roleCardSelected]}
              activeOpacity={0.7}
            >
              <Text style={styles.roleIcon}>{r.label.split(' ')[0]}</Text>
              <Text style={[styles.roleName, role === r.key && { color: colors.primary }]}>
                {r.label.split(' ').slice(1).join(' ')}
              </Text>
              <Text style={styles.roleDesc}>{r.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Jane Smith"
        />
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="jane@email.com"
          keyboardType="email-address"
        />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Min. 6 characters"
          secureTextEntry
        />

        {/* Phone — required for parents, optional for educators */}
        <Input
          label={isParent ? 'Phone number *' : 'Phone number (optional)'}
          value={phone}
          onChangeText={setPhone}
          placeholder="e.g. 905-555-0100"
          keyboardType="phone-pad"
        />
        {isParent && (
          <Text style={styles.phoneHint}>
            📞 Required so educators can reach you for emergencies or early pickups.
          </Text>
        )}

        <Button
          label="Create account"
          onPress={handleSignup}
          loading={loading}
          style={{ marginTop: spacing.md }}
        />

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginLink}>
          <Text style={styles.loginText}>
            Already have an account?{' '}
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: colors.bg,
    padding: spacing.xl, paddingTop: 60,
  },
  back: { marginBottom: spacing.xl },
  backText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { fontSize: 20, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xl },
  roleLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  roleRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  roleCard: {
    flex: 1, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md,
    alignItems: 'center', backgroundColor: colors.surface,
  },
  roleCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleIcon: { fontSize: 28, marginBottom: spacing.xs },
  roleName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  roleDesc: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  phoneHint: {
    fontSize: 12, color: colors.textSecondary,
    marginTop: -spacing.xs, marginBottom: spacing.sm, lineHeight: 17,
  },
  loginLink: { alignItems: 'center', marginTop: spacing.lg },
  loginText: { fontSize: 14, color: colors.textSecondary },
});
