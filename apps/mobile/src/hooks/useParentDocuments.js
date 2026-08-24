import { useCallback, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { supabase } from '../lib/supabase';
import { parentDocumentHtml } from '../lib/parentDocuments';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function safeFileName(value, fallback = 'document') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(-140);
  return cleaned || fallback;
}

function mimeFromName(name) {
  const extension = String(name || '').toLowerCase().split('.').pop();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function uploadKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function messageFor(error, fallback) {
  return error?.message || fallback;
}

export function normalizeParentDocumentAsset(asset) {
  if (!asset?.uri) return null;
  const name = safeFileName(asset.name || asset.fileName || 'document');
  const mimeType = asset.mimeType || mimeFromName(name);
  const file = new File(asset.uri);
  return {
    uri: asset.uri,
    name,
    mimeType,
    size: Number(asset.size || asset.fileSize || file.size || 0),
  };
}

export function validateParentDocumentAsset(asset) {
  if (!asset?.uri) return 'Choose a document before sending it.';
  if (!ALLOWED_MIME_TYPES.has(asset.mimeType)) return 'Choose a PDF, JPG, or PNG document.';
  if (!asset.size || asset.size > MAX_FILE_BYTES) return 'The document must be 10 MB or smaller.';
  return '';
}

export function useParentDocuments() {
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_parent_documents_hub');
    setLoading(false);
    if (loadError) {
      const message = messageFor(loadError, 'Your family documents could not be loaded.');
      setError(message);
      throw new Error(message);
    }
    setHub(data);
    return data;
  }, []);

  const submitRequest = useCallback(async ({ request, child, daycareId, userId, asset }) => {
    const selected = normalizeParentDocumentAsset(asset);
    const validationError = validateParentDocumentAsset(selected);
    if (validationError) throw new Error(validationError);
    if (!request?.id || !child?.id || !daycareId || !userId) {
      throw new Error('This document request is not ready for an upload.');
    }

    const storagePath = [
      'parent-documents', daycareId, child.id, request.id, userId,
      `${uploadKey()}-${selected.name}`,
    ].join('/');
    const body = await new File(selected.uri).arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, body, {
        contentType: selected.mimeType,
        cacheControl: '3600',
        upsert: false,
      });
    if (uploadError) throw new Error(messageFor(uploadError, 'The document could not be uploaded.'));

    const { data, error: submitError } = await supabase.rpc('submit_parent_document_request', {
      p_request_id: request.id,
      p_storage_path: storagePath,
      p_file_name: selected.name,
      p_mime_type: selected.mimeType,
      p_size_bytes: selected.size,
    });
    if (submitError) {
      await supabase.storage.from('documents').remove([storagePath]);
      throw new Error(messageFor(submitError, 'The document could not be sent to the office.'));
    }
    return data;
  }, []);

  const prepareRecordFile = useCallback(async ({ record, child, daycare, profile }) => {
    if (record?.storage_path) {
      const { data, error: signedError } = await supabase.storage
        .from('documents')
        .createSignedUrl(record.storage_path, 10 * 60);
      if (signedError || !data?.signedUrl) {
        throw new Error(messageFor(signedError, 'The secure document link could not be created.'));
      }
      const extension = record.mime_type === 'application/pdf'
        ? '.pdf'
        : record.mime_type === 'image/png' ? '.png' : '.jpg';
      const destination = new File(
        Paths.cache,
        `${uploadKey()}-${safeFileName(record.title, 'document')}${extension}`,
      );
      return File.downloadFileAsync(data.signedUrl, destination, { idempotent: true });
    }

    const { uri } = await Print.printToFileAsync({
      html: parentDocumentHtml({ record, child, daycare, profile }),
    });
    return new File(uri);
  }, []);

  const shareRecord = useCallback(async (context, mode = 'share') => {
    const file = await prepareRecordFile(context);
    if (!(await Sharing.isAvailableAsync())) return file.uri;
    await Sharing.shareAsync(file.uri, {
      mimeType: context.record?.mime_type || 'application/pdf',
      dialogTitle: mode === 'download' ? `Save ${context.record?.title || 'document'}` : `Share ${context.record?.title || 'document'}`,
      UTI: context.record?.mime_type === 'application/pdf' ? 'com.adobe.pdf' : undefined,
    });
    return file.uri;
  }, [prepareRecordFile]);

  return {
    hub,
    loading,
    error,
    refresh,
    submitRequest,
    prepareRecordFile,
    shareRecord,
  };
}
