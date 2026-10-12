import { Alert, Linking } from 'react-native';

export async function openConfiguredSupport(subject, fallbackMessage) {
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim();
  if (!supportEmail) {
    Alert.alert(
      'Contact your center',
      fallbackMessage || 'Ask your childcare center administrator for help. Their contact details are in your enrollment or employment documents.',
    );
    return false;
  }

  const url = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}`;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('Email is unavailable');
    await Linking.openURL(url);
    return true;
  } catch {
    Alert.alert('Email unavailable', `Contact ${supportEmail} from another device. Never include your password or pickup PIN.`);
    return false;
  }
}
