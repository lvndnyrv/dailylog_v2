import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1000;
const MANIFEST_SUFFIX = '.securemeta';
let storageChain = Promise.resolve();

function withStorageLock(operation) {
  const result = storageChain.then(operation, operation);
  storageChain = result.catch(() => undefined);
  return result;
}

function manifestKey(key) {
  return `${key}${MANIFEST_SUFFIX}`;
}

function chunkKey(key, generation, index) {
  return `${key}.${generation}.${index}`;
}

function createGeneration() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseManifest(raw) {
  if (!raw) return null;

  try {
    const manifest = JSON.parse(raw);
    if (
      !manifest
      || typeof manifest.generation !== 'string'
      || !/^[a-zA-Z0-9_]+$/.test(manifest.generation)
      || !Number.isSafeInteger(manifest.count)
      || manifest.count < 1
    ) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

async function deleteChunks(key, manifest) {
  if (!manifest) return;
  await Promise.all(
    Array.from({ length: manifest.count }, (_, index) => (
      SecureStore.deleteItemAsync(chunkKey(key, manifest.generation, index))
    ))
  );
}

async function readSecureValue(key) {
  const rawManifest = await SecureStore.getItemAsync(manifestKey(key));
  if (!rawManifest) return null;

  const manifest = parseManifest(rawManifest);
  if (!manifest) {
    throw new Error('DailyLog could not read the securely saved session.');
  }

  const chunks = await Promise.all(
    Array.from({ length: manifest.count }, (_, index) => (
      SecureStore.getItemAsync(chunkKey(key, manifest.generation, index))
    ))
  );

  if (chunks.some(chunk => chunk === null)) {
    throw new Error('DailyLog found an incomplete securely saved session.');
  }

  return chunks.join('');
}

async function writeSecureValue(key, value) {
  const oldManifest = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
  const generation = createGeneration();
  const chunks = [];

  for (let index = 0; index < value.length; index += CHUNK_SIZE) {
    chunks.push(value.slice(index, index + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push('');

  const newManifest = { generation, count: chunks.length };
  const writtenKeys = [];

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const keyForChunk = chunkKey(key, generation, index);
      await SecureStore.setItemAsync(keyForChunk, chunks[index]);
      writtenKeys.push(keyForChunk);
    }
    await SecureStore.setItemAsync(manifestKey(key), JSON.stringify(newManifest));
  } catch (error) {
    await Promise.all(writtenKeys.map(writtenKey => SecureStore.deleteItemAsync(writtenKey)));
    throw error;
  }

  await deleteChunks(key, oldManifest);
}

/**
 * Supabase-compatible storage adapter backed by the OS keychain/keystore.
 * Existing AsyncStorage sessions are migrated after the first successful read.
 */
export const secureAuthStorage = {
  getItem(key) {
    return withStorageLock(async () => {
      const secureValue = await readSecureValue(key);
      if (secureValue !== null) return secureValue;

      const legacyValue = await AsyncStorage.getItem(key);
      if (legacyValue === null) return null;

      try {
        await writeSecureValue(key, legacyValue);
        await AsyncStorage.removeItem(key);
      } catch (error) {
        // Preserve the working legacy session if the keychain is temporarily unavailable.
        console.warn('DailyLog could not migrate the saved session to secure storage.', error);
      }
      return legacyValue;
    });
  },

  setItem(key, value) {
    return withStorageLock(async () => {
      await writeSecureValue(key, value);
      await AsyncStorage.removeItem(key);
    });
  },

  removeItem(key) {
    return withStorageLock(async () => {
      const manifest = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
      await deleteChunks(key, manifest);
      await SecureStore.deleteItemAsync(manifestKey(key));
      await AsyncStorage.removeItem(key);
    });
  },
};
