import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, RefreshControl
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { LoadingScreen, EmptyState, Badge } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';

const ROLE_STYLE = {
  admin:    { label: 'Admin',    color: colors.purple,  bg: colors.purpleLight },
  educator: { label: 'Educator', color: colors.primary, bg: colors.primaryLight },
  parent:   { label: 'Parent',   color: colors.amber,   bg: colors.amberLight },
};

/**
 * Admin user management — list all daycare users, change roles.
 */
export default function AdminUsersScreen() {
  const isFocused = useIsFocused();
  const { profile } = useAuth();
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]     = useState('staff'); // staff | parents | all

  useEffect(() => {
    if (isFocused) load();
  }, [isFocused]);

  async function load() {
    const { data, error } = await supabase.rpc('get_daycare_users');
    if (error) showToast(`Couldn't load users: ${error.message}`, 'error');
    setUsers(data || []);
    setLoading(false);
    setRefreshing(false);
  }

  function handleChangeRole(user) {
    if (user.id === profile.id) {
      Alert.alert('Not allowed', 'You cannot change your own role.');
      return;
    }
    const options = ['educator', 'parent', 'admin']
      .filter(r => r !== user.role)
      .map(r => ({
        text: `Make ${ROLE_STYLE[r].label}`,
        onPress: async () => {
          const { error } = await supabase.rpc('admin_set_user_role', {
            p_user_id: user.id,
            p_role: r,
          });
          if (error) Alert.alert('Error', error.message);
          else {
            showToast(`${user.full_name} is now ${ROLE_STYLE[r].label}`, 'success');
            load();
          }
        },
      }));

    Alert.alert(
      `Change role — ${user.full_name}`,
      `Current role: ${ROLE_STYLE[user.role]?.label || user.role}`,
      [...options, { text: 'Cancel', style: 'cancel' }]
    );
  }

  const filtered = users.filter(u => {
    if (filter === 'staff') return u.role === 'educator' || u.role === 'admin';
    if (filter === 'parents') return u.role === 'parent';
    return true;
  });

  function renderUser({ item }) {
    const roleStyle = ROLE_STYLE[item.role] || ROLE_STYLE.parent;
    const isMe = item.id === profile.id;
    return (
      <TouchableOpacity
        style={styles.userCard}
        onPress={() => handleChangeRole(item)}
        activeOpacity={0.7}
        disabled={isMe}
      >
        <View style={styles.userAvatar}>
          <Text style={styles.userInitial}>{item.full_name?.[0] || '?'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>
            {item.full_name}{isMe ? ' (you)' : ''}
          </Text>
          <Text style={styles.userEmail}>{item.email}</Text>
          {item.classroom_name && (
            <Text style={styles.userRoom}>🏫 {item.classroom_name}</Text>
          )}
        </View>
        <Badge label={roleStyle.label} color={roleStyle.color} bg={roleStyle.bg} />
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Users</Text>
        <Text style={styles.headerSub}>{users.length} people · tap a user to change their role</Text>
      </View>

      {/* Filter */}
      <View style={styles.filterBar}>
        {[
          { key: 'staff',   label: 'Staff' },
          { key: 'parents', label: 'Parents' },
          { key: 'all',     label: 'All' },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={u => u.id}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        ListEmptyComponent={<EmptyState icon="👥" message="No users found." />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: spacing.xl, paddingTop: spacing.xl + spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  headerSub: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },
  filterBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  filterBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: colors.primary, fontWeight: '600' },
  list: { padding: spacing.lg },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  userAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  userInitial: { fontSize: 16, fontWeight: '700', color: colors.primary },
  userName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  userEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  userRoom: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});

