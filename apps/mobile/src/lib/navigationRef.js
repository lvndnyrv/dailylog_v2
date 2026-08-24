import { createNavigationContainerRef } from '@react-navigation/native';

// Shared navigation ref so non-screen code (e.g. push notification
// tap handlers) can navigate. Attached in App.js: <NavigationContainer ref={navigationRef}>
export const navigationRef = createNavigationContainerRef();
let pendingNavigation = null;

function rootRouteIsMounted(name) {
  if (!navigationRef.isReady()) return false;
  const state = navigationRef.getRootState();
  return Boolean(state?.routeNames?.includes(name));
}

export function navigate(name, params) {
  // The navigation container becomes ready before AuthProvider has finished
  // choosing the guest, staff or parent stack. Queue business links until the
  // destination is actually mounted; otherwise React Navigation drops a
  // perfectly valid cold-start notification tap.
  if (rootRouteIsMounted(name)) {
    navigationRef.navigate(name, params);
    return true;
  }
  pendingNavigation = { name, params };
  return false;
}

export function flushPendingNavigation() {
  if (!pendingNavigation || !rootRouteIsMounted(pendingNavigation.name)) return false;
  const { name, params } = pendingNavigation;
  pendingNavigation = null;
  navigationRef.navigate(name, params);
  return true;
}
