import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';

// ─── Global toast ────────────────────────────────────────────────────────────
// Mount <ToastHost /> once (App.js), then call showToast() from anywhere.

let pushToast = null;

/** Show a transient toast. type: 'info' | 'success' | 'error' */
export function showToast(message, type = 'info') {
  if (pushToast) pushToast({ message, type });
  else console.log(`[toast:${type}]`, message);
}

/** Convenience: format a Supabase/JS error into an error toast. */
export function toastError(prefix, error) {
  const detail = error?.message ? `: ${error.message}` : '';
  showToast(`${prefix}${detail}`, 'error');
}

const TYPE_STYLE = {
  info:    { bg: '#2F2E2B', text: '#FFFFFF' },
  success: { bg: colors.primaryDark, text: '#FFFFFF' },
  error:   { bg: colors.danger, text: '#FFFFFF' },
};

export function ToastHost() {
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef(null);

  useEffect(() => {
    pushToast = (next) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast(next);

      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(
          ({ finished }) => { if (finished) setToast(null); }
        );
      }, 2600);
    };
    return () => {
      pushToast = null;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [opacity]);

  if (!toast) return null;
  const palette = TYPE_STYLE[toast.type] || TYPE_STYLE.info;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.toast, { opacity, backgroundColor: palette.bg }]}
    >
      <Text style={[styles.text, { color: palette.text }]} numberOfLines={3}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 104, // above the tab bar
    left: spacing.xl,
    right: spacing.xl,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  text: { fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 19 },
});

