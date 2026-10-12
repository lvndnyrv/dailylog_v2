import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, spacing, radius } from '../theme';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function DatePickerField({
  label,
  value,
  onChange,
  placeholder = 'Select date of birth',
  minimumDate = new Date(2010, 0, 1),
  maximumDate = new Date(),
  defaultDate,
  error,
  style,
}) {
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
    <View style={[styles.wrap, style]}>
      {label && <Text style={styles.label}>{label}</Text>}

      <TouchableOpacity
        onPress={() => setShow(true)}
        style={[styles.btn, error && styles.btnError]}
        activeOpacity={0.7}
        accessibilityState={{ invalid: Boolean(error) }}
      >
        <Text style={displayValue ? styles.btnText : styles.btnPlaceholder}>
          {displayValue || placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textFaint} />
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {show && (
        <DateTimePicker
          value={parsed || defaultDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary, marginBottom: spacing.sm },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  btnError: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  errorText: { marginTop: 5, fontSize: 11.5, fontFamily: fonts.regular, color: colors.danger },
  btnText:        { fontSize: 15, fontFamily: fonts.regular, color: colors.textPrimary },
  btnPlaceholder: { fontSize: 15, fontFamily: fonts.regular, color: colors.textFaint },
});
