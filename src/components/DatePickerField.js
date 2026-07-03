import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, spacing, radius } from '../theme';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function DatePickerField({ label, value, onChange }) {
  const [show, setShow] = useState(false);

  const parsed = value ? new Date(value + 'T00:00:00') : null;

  const displayValue = value
    ? `${MONTHS[parseInt(value.split('-')[1]) - 1]} ${parseInt(value.split('-')[2])}, ${value.split('-')[0]}`
    : null;

  function handleChange(event, selectedDate) {
    if (Platform.OS === 'android') setShow(false);
    if (event.type === 'dismissed') { setShow(false); return; }
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(selectedDate.getDate()).padStart(2, '0');
      onChange(`${y}-${mm}-${dd}`);
    }
    if (Platform.OS === 'ios') setShow(false);
  }

  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}

      <TouchableOpacity onPress={() => setShow(true)} style={styles.btn} activeOpacity={0.7}>
        <Text style={displayValue ? styles.btnText : styles.btnPlaceholder}>
          {displayValue || 'Select date of birth'}
        </Text>
        <Text style={styles.icon}>📅</Text>
      </TouchableOpacity>

      {show && (
        <DateTimePicker
          value={parsed || new Date(2020, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          minimumDate={new Date(2010, 0, 1)}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.xs },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  btnText:        { fontSize: 15, color: colors.textPrimary },
  btnPlaceholder: { fontSize: 15, color: colors.textMuted },
  icon: { fontSize: 16 },
});
