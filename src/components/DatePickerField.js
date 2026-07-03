import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView
} from 'react-native';
import { colors, spacing, radius } from '../theme';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function DatePickerField({ label, value, onChange }) {
  const [open, setOpen] = useState(false);

  const now = new Date();
  const parsed = value ? new Date(value + 'T00:00:00') : null;

  const [year,  setYear]  = useState(parsed?.getFullYear()  ?? 2022);
  const [month, setMonth] = useState(parsed?.getMonth()     ?? 0);
  const [day,   setDay]   = useState(parsed?.getDate()      ?? 1);

  const years = range(2015, now.getFullYear()).reverse();
  const days  = range(1, new Date(year, month + 1, 0).getDate());

  function confirm() {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${year}-${mm}-${dd}`);
    setOpen(false);
  }

  const displayValue = value
    ? `${MONTHS[parseInt(value.split('-')[1]) - 1]} ${parseInt(value.split('-')[2])}, ${value.split('-')[0]}`
    : null;

  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}

      <TouchableOpacity onPress={() => setOpen(true)} style={styles.btn} activeOpacity={0.7}>
        <Text style={displayValue ? styles.btnText : styles.btnPlaceholder}>
          {displayValue || 'Select date of birth'}
        </Text>
        <Text style={styles.icon}>📅</Text>
      </TouchableOpacity>

      <Modal transparent animationType="slide" visible={open}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.title}>Date of birth</Text>
              <TouchableOpacity onPress={confirm}>
                <Text style={styles.done}>Done</Text>
              </TouchableOpacity>
            </View>

            {/* Preview */}
            <Text style={styles.preview}>
              {MONTHS[month]} {day}, {year}
            </Text>

            <View style={styles.columns}>
              {/* Month */}
              <View style={styles.col}>
                <Text style={styles.colLabel}>Month</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {MONTHS.map((m, i) => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setMonth(i)}
                      style={[styles.item, i === month && styles.itemSelected]}
                    >
                      <Text style={[styles.itemText, i === month && styles.itemTextSelected]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Day */}
              <View style={[styles.col, { width: 60 }]}>
                <Text style={styles.colLabel}>Day</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {days.map(d => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => setDay(d)}
                      style={[styles.item, d === day && styles.itemSelected]}
                    >
                      <Text style={[styles.itemText, d === day && styles.itemTextSelected]}>
                        {String(d).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Year */}
              <View style={[styles.col, { width: 80 }]}>
                <Text style={styles.colLabel}>Year</Text>
                <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                  {years.map(y => (
                    <TouchableOpacity
                      key={y}
                      onPress={() => setYear(y)}
                      style={[styles.item, y === year && styles.itemSelected]}
                    >
                      <Text style={[styles.itemText, y === year && styles.itemTextSelected]}>{y}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title:   { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cancel:  { fontSize: 16, color: colors.textSecondary },
  done:    { fontSize: 16, color: colors.primary, fontWeight: '600' },
  preview: {
    textAlign: 'center', fontSize: 18, fontWeight: '600',
    color: colors.primary, paddingVertical: spacing.md,
  },
  columns: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  col:     { width: 90, alignItems: 'center' },
  colLabel:{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  scroll:  { height: 200 },
  item:    { paddingVertical: spacing.sm + 1, paddingHorizontal: spacing.sm, borderRadius: radius.md, alignItems: 'center', width: '100%' },
  itemSelected:     { backgroundColor: colors.primaryLight },
  itemText:         { fontSize: 16, color: colors.textSecondary },
  itemTextSelected: { color: colors.primary, fontWeight: '700' },
});
