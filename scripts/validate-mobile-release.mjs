import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mobile = resolve(root, 'apps/mobile');
const app = JSON.parse(readFileSync(resolve(mobile, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(resolve(mobile, 'eas.json'), 'utf8'));
const mobilePackage = JSON.parse(readFileSync(resolve(mobile, 'package.json'), 'utf8'));
const errors = [];

function requireValue(label, value, predicate = (item) => Boolean(item)) {
  if (!predicate(value)) errors.push(`${label} is missing or still a placeholder`);
}

requireValue('Expo SDK 56 dependency alignment', mobilePackage.dependencies?.expo, (value) =>
  /(?:\^|~)?56\./.test(value),
);

requireValue('extra.eas.projectId', app.extra?.eas?.projectId, (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);
requireValue('ios.bundleIdentifier', app.ios?.bundleIdentifier, (value) =>
  /^[a-zA-Z][a-zA-Z0-9.-]+$/.test(value) && value !== 'com.dailylog.app',
);
requireValue('android.package', app.android?.package, (value) =>
  /^[a-zA-Z][a-zA-Z0-9_.]+$/.test(value) && value !== 'com.dailylog.app',
);
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

if (errors.length) {
  console.error(`Mobile release configuration is not ready:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log('Mobile release configuration is ready.');
