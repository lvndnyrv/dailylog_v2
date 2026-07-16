/**
 * Avatar URL cache — avoids re-minting signed URLs on every ChildAvatar mount.
 * Stores { signedUrl, expiresAt } per storage path. TTL = 55 minutes
 * (signed URLs expire at 60 min, so we refresh 5 min early).
 */
const cache = new Map();
const TTL_MS = 55 * 60 * 1000; // 55 minutes

export function getCachedUrl(path) {
  const entry = cache.get(path);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(path);
    return null;
  }
  return entry.signedUrl;
}

export function setCachedUrl(path, signedUrl) {
  cache.set(path, { signedUrl, expiresAt: Date.now() + TTL_MS });
}

export function clearAvatarCache() {
  cache.clear();
}

