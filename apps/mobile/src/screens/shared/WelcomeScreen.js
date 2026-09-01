import React, { useRef, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui';
import { colors, fonts, radius, spacing } from '../../theme';

export const WELCOME_SEEN_KEY = 'dailylog:welcome_seen';

const SLIDES = [
  {
    id: 'child-day',
    image: require('../../../assets/onboarding/child-day.jpg'),
    imageLabel: 'An educator logging a child’s day while the child plays',
    title: "Your child's day,\nin your pocket",
    body: 'Meals, naps, diapers, activities and photos — shared by educators in real time, the moment they happen.',
  },
  {
    id: 'stay-connected',
    image: require('../../../assets/onboarding/stay-connected.jpg'),
    imageLabel: 'A parent and educator staying connected at daycare pickup',
    title: 'Stay connected\nwith your daycare',
    body: 'Chat directly with educators, get announcements, and receive instant alerts if anything needs your attention.',
  },
  {
    id: 'private-secure',
    image: require('../../../assets/onboarding/private-secure.jpg'),
    imageLabel: 'A family protected by a secure shield',
    title: 'Private and secure\nby design',
    body: "Your child's data is only visible to you and your daycare's staff. Never sold, never shared with anyone else.",
  },
];

export default function WelcomeScreen({ onDone }) {
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLast = index === SLIDES.length - 1;
  const heroHeight = Math.min(400, Math.max(310, Math.min(width, height * 0.46)));

  async function finish() {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, '1');
    onDone();
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }

    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    setIndex(current => Math.min(current + 1, SLIDES.length - 1));
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, itemIndex) => ({
          length: width,
          offset: width * itemIndex,
          index: itemIndex,
        })}
        onMomentumScrollEnd={event => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
        }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <Image
              source={item.image}
              resizeMode="cover"
              style={[styles.hero, { height: heroHeight }]}
              accessibilityLabel={item.imageLabel}
            />
            <View style={styles.copy}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          </View>
        )}
      />

      <TouchableOpacity
        onPress={finish}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel="Skip onboarding"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.skip}
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.xxl) }]}>
        <View
          style={styles.dots}
          accessibilityLabel={`Onboarding step ${index + 1} of ${SLIDES.length}`}
        >
          {SLIDES.map((slide, dotIndex) => (
            <View
              key={slide.id}
              style={[styles.dot, dotIndex === index && styles.dotActive]}
            />
          ))}
        </View>
        <Button
          label={isLast ? 'Create account' : 'Next'}
          onPress={next}
          style={styles.nextButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  slide: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  hero: {
    width: '100%',
    backgroundColor: colors.primaryLight,
  },
  copy: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 28,
    lineHeight: 35,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  body: {
    maxWidth: 340,
    marginTop: spacing.md,
    fontSize: 15.5,
    lineHeight: 24,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  skip: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.xl,
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 3,
  },
  skipText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  footer: {
    paddingHorizontal: 28,
    paddingTop: spacing.sm,
    gap: spacing.lg,
    backgroundColor: colors.bg,
  },
  dots: {
    minHeight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: '#C6D5E9',
  },
  dotActive: {
    width: 26,
    backgroundColor: colors.primary,
  },
  nextButton: {
    width: '100%',
  },
});
