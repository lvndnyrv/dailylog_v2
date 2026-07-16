import { createNavigationContainerRef } from '@react-navigation/native';

// Shared navigation ref so non-screen code (e.g. push notification
// tap handlers) can navigate. Attached in App.js: <NavigationContainer ref={navigationRef}>
export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

