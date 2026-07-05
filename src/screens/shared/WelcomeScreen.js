import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

const { width } = Dimensions.get('window');

export const WELCOME_SEEN_KEY = 'dailylog:welcome_seen';

const SLIDES = [
  {
    emoji: '📋',
    title: "Your child's day,\nin your pocket",
    body: 'Meals, naps, diapers, activities and photos — shared by educators in real time, the moment they happen.',
  },
  {
    emoji: '💬',
    title: 'Stay connected\nwith your daycare',
    body: 'Chat directly with educators, get announcements, and receive instant alerts if anything needs your attention.',
  },
  {
    emoji: '🔒',
    title: 'Private and secure\nby design',
    body: "Your child's data is only visible to you and your daycare's staff. Never sold, never shared with anyone else.",
  },
];

export default function WelcomeScreen({ onDone }) {
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const isLast = index === SLIDES.length - 1;

  async function finish() {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, '1');
    onDone();
  }

  function next() {
    if (isLast) { finish(); return; }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={finish} style={styles.skip} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={s => s.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <Text style={styles.emoji}>{item.emoji}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <Button label={isLast ? 'Get started' : 'Next'} onPress={next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skip: { position: 'absolute', top: 24, right: spacing.xl, zIndex: 10 },
  skipText: { fontSize: 15, color: colors.textMuted, fontWeight: '500' },
  slide: {
    width, flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emoji: { fontSize: 72, marginBottom: spacing.xl },
  title: {
    fontSize: 28, fontWeight: '700', color: colors.textPrimary,
    textAlign: 'center', lineHeight: 36, marginBottom: spacing.lg,
  },
  body: {
    fontSize: 16, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 24,
  },
  dots: {
    flexDirection: 'row', justifyContent: 'center',
    gap: spacing.sm, marginBottom: spacing.xl,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.primary, width: 24 },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
});

