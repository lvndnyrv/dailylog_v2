import React from 'react';
import { ScrollView } from 'react-native';

/**
 * Expo 56 / React Native's native ScrollView handles keyboard insets on iOS.
 * Keep the existing screen API while avoiding the legacy UIManager calls made
 * by react-native-keyboard-aware-scroll-view under the New Architecture.
 */
export function KeyboardAwareScrollView({
  enableOnAndroid: _enableOnAndroid,
  extraScrollHeight: _extraScrollHeight,
  extraHeight: _extraHeight,
  enableAutomaticScroll: _enableAutomaticScroll,
  keyboardOpeningTime: _keyboardOpeningTime,
  ...props
}) {
  return <ScrollView automaticallyAdjustKeyboardInsets {...props} />;
}
