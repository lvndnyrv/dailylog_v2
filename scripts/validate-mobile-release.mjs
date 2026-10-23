import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mobile = resolve(root, 'apps/mobile');
const app = JSON.parse(readFileSync(resolve(mobile, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(resolve(mobile, 'eas.json'), 'utf8'));
const mobilePackage = JSON.parse(readFileSync(resolve(mobile, 'package.json'), 'utf8'));
const privacyScreen = readFileSync(
  resolve(mobile, 'src/screens/shared/PrivacyScreen.js'),
  'utf8',
);
const publicPrivacyPage = resolve(root, 'apps/web/src/app/privacy/page.tsx');
const publicDeletionPage = resolve(root, 'apps/web/src/app/account-deletion/page.tsx');
const publicSupportPage = resolve(root, 'apps/web/src/app/support/page.tsx');
const authHook = readFileSync(resolve(mobile, 'src/hooks/useAuth.js'), 'utf8');
const errors = [];

function requireValue(label, value, predicate = (item) => Boolean(item)) {
  if (!predicate(value)) errors.push(`${label} is missing or still a placeholder`);
}

requireValue('Expo SDK 57 dependency alignment', mobilePackage.dependencies?.expo, (value) =>
  /(?:\^|~)?57\./.test(value),
);
const dependencyCheck = spawnSync('pnpm', ['--filter', '@dailylog/mobile', 'check:dependencies'], {
  cwd: root,
  encoding: 'utf8',
});
if (dependencyCheck.error || dependencyCheck.status !== 0) {
  errors.push('Expo SDK package versions are not aligned (run pnpm check:mobile-dependencies)');
  if (dependencyCheck.error) console.error(dependencyCheck.error.message);
  else console.error(dependencyCheck.stdout || dependencyCheck.stderr);
}

requireValue('extra.eas.projectId', app.extra?.eas?.projectId, (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);
requireValue('ios.bundleIdentifier', app.ios?.bundleIdentifier, (value) =>
  /^[a-zA-Z][a-zA-Z0-9.-]+$/.test(value) && value !== 'com.dailylog.app',
);
requireValue('android.package', app.android?.package, (value) =>
  /^[a-zA-Z][a-zA-Z0-9_.]+$/.test(value) && value !== 'com.dailylog.app',
);
requireValue('ios.buildNumber', app.ios?.buildNumber, (value) => /^\d+$/.test(value));
requireValue('android.versionCode', app.android?.versionCode, (value) =>
  Number.isSafeInteger(value) && value > 0,
);
requireValue('runtimeVersion fingerprint policy', app.runtimeVersion?.policy, (value) =>
  value === 'fingerprint',
);
requireValue('EAS Update URL', app.updates?.url, (value) =>
  value === `https://u.expo.dev/${app.extra?.eas?.projectId}`,
);
requireValue('automatic update checks', app.updates?.checkAutomatically, (value) =>
  value === 'ON_LOAD',
);

for (const [profile, channel] of Object.entries({
  development: 'development',
  preview: 'preview',
  production: 'production',
})) {
  requireValue(`eas.build.${profile}.channel`, eas.build?.[profile]?.channel, (value) =>
    value === channel,
  );
}
requireValue('extra.storeUrls.ios', app.extra?.storeUrls?.ios, (value) =>
  /^https:\/\/apps\.apple\.com\/.+\/app\//.test(value) && !value.includes('YOUR_'),
);
requireValue('extra.storeUrls.android', app.extra?.storeUrls?.android, (value) =>
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=/.test(value) && !value.includes('YOUR_'),
);

const iosSubmit = eas.submit?.production?.ios ?? {};
for (const [key, value] of Object.entries({
  appleId: iosSubmit.appleId,
  ascAppId: iosSubmit.ascAppId,
  appleTeamId: iosSubmit.appleTeamId,
})) {
  requireValue(`eas.submit.production.ios.${key}`, value, (item) => Boolean(item) && !item.includes('YOUR_'));
}

const serviceAccountPath = eas.submit?.production?.android?.serviceAccountKeyPath;
requireValue('Android service account path', serviceAccountPath, (value) =>
  Boolean(value) && existsSync(resolve(mobile, value)),
);

const notifications = app.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications');
const notificationIcon = notifications?.[1]?.icon;
requireValue('Dedicated Android notification icon', notificationIcon, (value) =>
  Boolean(value) && value !== './assets/icon.png' && existsSync(resolve(mobile, value)),
);

const pluginOptions = (name) => app.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === name,
)?.[1];
requireValue('Image picker microphone disabled', pluginOptions('expo-image-picker')?.microphonePermission, (value) =>
  value === false,
);
requireValue('Camera microphone disabled', pluginOptions('expo-camera')?.microphonePermission, (value) =>
  value === false,
);
requireValue('Calendar write-only access', pluginOptions('expo-calendar')?.writeOnlyAccess, (value) =>
  value === true,
);
requireValue('Calendar reminders disabled', pluginOptions('expo-calendar')?.remindersPermission, (value) =>
  value === false,
);
requireValue('Face ID purpose string', pluginOptions('expo-secure-store')?.faceIDPermission, (value) =>
  typeof value === 'string' && value.includes('app lock'),
);

for (const permission of [
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
  'android.permission.RECORD_AUDIO',
]) {
  requireValue(`Blocked unused permission ${permission}`, app.android?.blockedPermissions, (values) =>
    Array.isArray(values) && values.includes(permission),
  );
}

requireValue('Public privacy policy page', publicPrivacyPage, (value) => existsSync(value));
requireValue('Public account deletion page', publicDeletionPage, (value) => existsSync(value));
requireValue('Public support page', publicSupportPage, (value) => existsSync(value));
requireValue('EXPO_PUBLIC_SUPPORT_EMAIL', process.env.EXPO_PUBLIC_SUPPORT_EMAIL, (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || ''),
);
requireValue('NEXT_PUBLIC_SUPPORT_EMAIL', process.env.NEXT_PUBLIC_SUPPORT_EMAIL, (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || ''),
);
requireValue('NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL, (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
});
requireValue('No immediate client-side account deletion', authHook, (value) =>
  !value.includes("rpc('delete_my_account')"),
);
for (const staleClaim of [
  'privacy@yourdomain.app',
  'hosted in a Canadian data region',
  'automatically deleted',
]) {
  requireValue(`Privacy policy without stale claim: ${staleClaim}`, privacyScreen, (value) =>
    !value.includes(staleClaim),
  );
}

if (errors.length) {
  console.error(`Mobile release configuration is not ready:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log('Mobile release configuration is ready.');
