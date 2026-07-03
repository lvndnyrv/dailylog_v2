import React, { useState, useEffect } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { getCachedUrl, setCachedUrl } from '../lib/avatarCache';
import { colors } from '../theme';

/**
 * Displays a child's profile photo or falls back to initials.
 * Uses a module-level URL cache (55-min TTL) so roster focus
 * doesn't re-mint signed URLs for every avatar.
 *
 * Props:
 *  - child: { first_name, last_name, photo_url }
 *  - size: number (default 48)
 *  - fontSize: number (default size * 0.35)
 */
export function ChildAvatar({ child, size = 48, fontSize }) {
  const [imageUrl, setImageUrl] = useState(() => getCachedUrl(child?.photo_url));
  const resolvedFontSize = fontSize || Math.round(size * 0.35);

  useEffect(() => {
    if (!child?.photo_url) {
      setImageUrl(null);
      return;
    }

    const cached = getCachedUrl(child.photo_url);
    if (cached) {
      setImageUrl(cached);
      return;
    }

    // Get a signed URL for the stored photo
    async function getUrl() {
      const { data } = await supabase.storage
        .from('child-avatars')
        .createSignedUrl(child.photo_url, 3600); // 1 hour
      if (data?.signedUrl) {
        setCachedUrl(child.photo_url, data.signedUrl);
        setImageUrl(data.signedUrl);
      }
    }
    getUrl();
  }, [child?.photo_url]);

  const initials = `${child?.first_name?.[0] || '?'}${child?.last_name?.[0] || ''}`;

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.image, containerStyle]}
      />
    );
  }

  return (
    <View style={[styles.fallback, containerStyle]}>
      <Text style={[styles.initials, { fontSize: resolvedFontSize }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    resizeMode: 'cover',
  },
  fallback: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '700',
    color: colors.primary,
  },
});

