import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { File } from 'expo-file-system';

import { supabase } from '../lib/supabase';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);

function mimeFromName(name = '') {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'application/octet-stream';
}

function safeFileName(name = 'credential') {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'credential';
}

function uploadKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function credentialAttention(credentials = []) {
  return credentials.find((credential) => credential.latestSubmission?.status === 'rejected')
    || credentials.find((credential) => credential.status === 'missing')
    || credentials.find((credential) => credential.status === 'expired')
    || credentials.find((credential) => credential.status === 'expiring')
    || null;
}

export function useCredentials() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const { data: result, error: loadError } = await supabase.rpc(
      'get_mobile_staff_credentials'
    );
    if (loadError) {
      setError(loadError);
    } else {
      setData(result || { credentials: [] });
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
    return result;
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    return load({ quiet: true });
  }, [load]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  return {
    data,
    credentials: data?.credentials || [],
    loading,
    refreshing,
    error,
    load,
    refresh,
  };
}

export async function submitCredentialRenewal({
  credential,
  staffMemberId,
  daycareId,
  userId,
  issuer,
  completedOn,
  expiresOn,
  credentialNumber,
  asset,
}) {
  if (!credential?.id) throw new Error('Credential not found.');
  if (!staffMemberId || !daycareId || !userId) {
    throw new Error('Your staff profile is not ready for uploads.');
  }
  if (!asset?.uri) throw new Error('Choose a certificate document.');

  const mimeType = asset.mimeType || mimeFromName(asset.name);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('Choose a PDF, JPG, PNG or HEIC document.');
  }
  const file = new File(asset.uri);
  const sizeBytes = Number(asset.size || file.size || 0);
  if (!sizeBytes || sizeBytes > MAX_FILE_BYTES) {
    throw new Error('The document must be 10 MB or smaller.');
  }

  const fileName = safeFileName(asset.name || file.name);
  const storagePath = [
    'staff-credentials', daycareId, userId, credential.id,
    `${uploadKey()}-${fileName}`,
  ].join('/');
  const body = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, body, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message || 'The document could not be uploaded.');

  const { data: submissionId, error: submitError } = await supabase.rpc(
    'submit_mobile_credential_renewal',
    {
      p_credential_id: credential.id,
      p_issuer: issuer.trim(),
      p_completed_on: completedOn,
      p_expires_on: expiresOn,
      p_credential_number: credentialNumber.trim() || null,
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_mime_type: mimeType,
      p_size_bytes: sizeBytes,
    }
  );
  if (submitError) {
    await supabase.storage.from('documents').remove([storagePath]);
    throw new Error(submitError.message || 'The renewal could not be submitted.');
  }
  return submissionId;
}

export async function withdrawCredentialSubmission(submissionId) {
  const { error } = await supabase.rpc('withdraw_mobile_credential_submission', {
    p_submission_id: submissionId,
  });
  if (error) throw new Error(error.message || 'The renewal could not be withdrawn.');
}

export async function getCredentialDocumentUrl(storagePath) {
  if (!storagePath) throw new Error('No document is on file.');
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, 10 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'The document could not be opened.');
  }
  return data.signedUrl;
}
