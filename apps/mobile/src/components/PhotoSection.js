import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Alert, ScrollView, ActivityIndicator, Modal
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { getPhotoConsentStatuses } from '../hooks/useStaffVisibility';
import { colors, spacing, radius, fonts } from '../theme';

export function PhotoSection({ logId, childId, readOnly = false }) {
  const { profile }           = useAuth();
  const [photos, setPhotos]   = useState([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null); // full-screen preview URL
  const [failedIds, setFailedIds] = useState(new Set());
  const [photoAllowed, setPhotoAllowed] = useState(readOnly);
  const [checkingConsent, setCheckingConsent] = useState(!readOnly);

  useEffect(() => {
    if (!logId) return;
    loadPhotos();

    // Real-time updates so parents see photos as they're added
    const channelInstance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`photos:${logId}:${channelInstance}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'photos',
        filter: `daily_log_id=eq.${logId}`,
      }, () => loadPhotos())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [logId]);

  useEffect(() => {
    let active = true;
    async function checkConsent() {
      if (readOnly || !childId) {
        if (active) {
          setPhotoAllowed(Boolean(readOnly));
          setCheckingConsent(false);
        }
        return;
      }
      setCheckingConsent(true);
      try {
        const rows = await getPhotoConsentStatuses([childId]);
        if (active) setPhotoAllowed(Boolean(rows?.find((row) => row.child_id === childId)?.allowed));
      } catch {
        if (active) setPhotoAllowed(false);
      } finally {
        if (active) setCheckingConsent(false);
      }
    }
    checkConsent();
    return () => { active = false; };
  }, [childId, readOnly]);

  async function loadPhotos() {
    const { data } = await supabase
      .from('photos')
      .select('*')
      .eq('daily_log_id', logId)
      .order('created_at');

    if (!data) return;

    // Get signed URLs for each photo
    const withUrls = await Promise.all(
      data.map(async photo => {
        const { data: urlData } = await supabase.storage
          .from('daily-log-photos')
          .createSignedUrl(photo.storage_path, 3600);
        return { ...photo, url: urlData?.signedUrl };
      })
    );
    setPhotos(withUrls);
    setFailedIds(new Set());
  }

  async function handlePickPhoto() {
    if (!photoAllowed) {
      Alert.alert(
        'Photo permission required',
        'This family has declined photo sharing or has not answered yet. New photos are blocked until the parent allows them.',
      );
      return;
    }
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library to attach photos.');
      return;
    }

    Alert.alert(
      'Add photo',
      'Choose a source',
      [
        { text: 'Camera', onPress: () => pickFromCamera() },
        { text: 'Photo library', onPress: () => pickFromLibrary() },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) uploadPhoto(result.assets[0].uri);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.length) {
      await uploadMultiplePhotos(result.assets.map(a => a.uri));
    }
  }

  async function uploadMultiplePhotos(uris) {
    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (const uri of uris) {
      let uploadedPath = null;
      try {
        const manipResult = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );

        const response = await fetch(manipResult.uri);
        const arrayBuffer = await response.arrayBuffer();
        const path = `${childId}/${logId}/${Date.now()}_${successCount}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('daily-log-photos')
          .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: false });

        if (uploadError) throw uploadError;
        uploadedPath = path;

        const { error: dbError } = await supabase.from('photos').insert({
          daily_log_id: logId,
          uploader_id: profile.id,
          storage_path: path,
        });

        if (dbError) throw dbError;
        successCount++;
      } catch (err) {
        if (uploadedPath) {
          await supabase.storage.from('daily-log-photos').remove([uploadedPath]);
        }
        failCount++;
      }
    }

    await loadPhotos();
    setUploading(false);

    if (failCount > 0 && successCount > 0) {
      Alert.alert('Partial upload', `${successCount} photo(s) uploaded, ${failCount} failed.`);
    } else if (failCount > 0 && successCount === 0) {
      Alert.alert('Upload failed', 'Could not upload the selected photos.');
    }
  }

  async function uploadPhoto(uri) {
    setUploading(true);
    let uploadedPath = null;
    try {
      // Resize to max 1200px wide to keep storage lean
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Read file as ArrayBuffer (reliable in React Native unlike blob)
      const response  = await fetch(manipResult.uri);
      const arrayBuffer = await response.arrayBuffer();
      const path      = `${childId}/${logId}/${Date.now()}.jpg`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('daily-log-photos')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;
      uploadedPath = path;

      // Save metadata
      const { error: dbError } = await supabase.from('photos').insert({
        daily_log_id: logId,
        uploader_id: profile.id,
        storage_path: path,
      });

      if (dbError) throw dbError;

      await loadPhotos();
    } catch (err) {
      if (uploadedPath) {
        await supabase.storage.from('daily-log-photos').remove([uploadedPath]);
      }
      Alert.alert('Upload failed', err.message);
    }
    setUploading(false);
  }

  async function deletePhoto(photo) {
    // Remove optimistically from UI, then delete from storage + DB
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
    await supabase.storage.from('daily-log-photos').remove([photo.storage_path]);
    await supabase.from('photos').delete().eq('id', photo.id);
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeading}>
          <View style={styles.sectionIcon}>
            <Ionicons name="camera-outline" size={19} color={colors.primary} />
          </View>
          <Text style={styles.sectionTitle}>Photos</Text>
        </View>
        {!readOnly && photoAllowed && (
          <TouchableOpacity
            onPress={handlePickPhoto}
            disabled={uploading}
            style={styles.addPhotoBtn}
            activeOpacity={0.7}
          >
            {uploading
              ? <ActivityIndicator color={colors.primary} size="small" />
              : <>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addPhotoBtnText}>Add</Text>
                </>
            }
          </TouchableOpacity>
        )}
      </View>

      {!readOnly && checkingConsent && (
        <View style={styles.consentChecking}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.consentCheckingText}>Checking photo permission…</Text>
        </View>
      )}

      {!readOnly && !checkingConsent && !photoAllowed && (
        <View style={styles.consentBlocked}>
          <View style={styles.consentBlockedIcon}>
            <Ionicons name="shield-outline" size={20} color={colors.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.consentBlockedTitle}>Photo uploads restricted</Text>
            <Text style={styles.consentBlockedText}>The family declined photo consent or has not answered yet.</Text>
          </View>
        </View>
      )}

      {photos.length === 0 && !readOnly && photoAllowed && !checkingConsent && (
        <TouchableOpacity onPress={handlePickPhoto} style={styles.emptyBtn} disabled={uploading}>
          <View style={styles.emptyIcon}>
            <Ionicons name="camera-outline" size={23} color={colors.primary} />
          </View>
          <Text style={styles.emptyText}>Tap to add a photo</Text>
          <Text style={styles.emptyHint}>Snap a craft project, lunch, or outdoor activity</Text>
        </TouchableOpacity>
      )}

      {photos.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
          {photos.map(photo => (
            <View key={photo.id} style={styles.thumbWrap}>
              <TouchableOpacity
                onPress={() => setPreview(photo.url)}
                activeOpacity={0.85}
              >
                {photo.url && !failedIds.has(photo.id)
                  ? <Image
                      source={{ uri: photo.url }}
                      style={styles.thumb}
                      onError={() => setFailedIds(prev => new Set([...prev, photo.id]))}
                    />
                  : <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      {failedIds.has(photo.id)
                        ? <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                        : <ActivityIndicator color={colors.textMuted} />
                      }
                    </View>
                }
              </TouchableOpacity>
              {!readOnly && (
                <TouchableOpacity
                  onPress={() => deletePhoto(photo)}
                  style={styles.thumbDeleteBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close" size={13} color={colors.white} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {!readOnly && photoAllowed && !checkingConsent && (
            <TouchableOpacity onPress={handlePickPhoto} style={styles.addThumb} disabled={uploading}>
              {uploading
                ? <ActivityIndicator color={colors.primary} />
                : <Ionicons name="add" size={26} color={colors.primary} />
              }
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* Full-screen preview */}
      <Modal visible={!!preview} transparent animationType="fade">
        <TouchableOpacity style={styles.previewOverlay} onPress={() => setPreview(null)} activeOpacity={1}>
          <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="contain" />
          <TouchableOpacity onPress={() => setPreview(null)} style={styles.previewClose}>
            <Ionicons name="close" size={20} color={colors.white} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface, borderRadius: 18,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md,
    overflow: 'visible',
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  sectionHeading: { flexDirection: 'row', alignItems: 'center' },
  sectionIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarySoft, marginRight: spacing.md,
  },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  addPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.md,
  },
  addPhotoBtnText: { fontSize: 12.5, color: colors.primary, fontFamily: fonts.bold },
  consentChecking: {
    minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft,
  },
  consentCheckingText: { flex: 1, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textMuted },
  consentBlocked: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight,
  },
  consentBlockedIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  consentBlockedTitle: { fontSize: 13.5, color: colors.danger, fontFamily: fonts.bold },
  consentBlockedText: { marginTop: 2, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular, color: colors.textMuted },
  emptyBtn: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.xl,
    alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.primarySoft,
  },
  emptyIcon: {
    width: 42, height: 42, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  emptyText: { fontSize: 14, color: colors.textPrimary, fontFamily: fonts.bold },
  emptyHint: { fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted, textAlign: 'center' },
  photoScroll: { marginHorizontal: -spacing.xs, paddingTop: 8, paddingLeft: 8 },
  thumbWrap: { marginRight: spacing.sm + 4, position: 'relative' },
  thumb: {
    width: 100, height: 100, borderRadius: radius.md,
    overflow: 'hidden', resizeMode: 'cover',
    backgroundColor: colors.bg,
  },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbDeleteBtn: {
    position: 'absolute', top: -4, right: -4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 2, elevation: 3,
  },
  addThumb: {
    width: 100, height: 100, borderRadius: radius.md,
    backgroundColor: colors.bg, borderWidth: 1.5,
    borderStyle: 'dashed', borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  previewOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center', alignItems: 'center',
  },
  previewImage: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', top: 52, right: 20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
});
