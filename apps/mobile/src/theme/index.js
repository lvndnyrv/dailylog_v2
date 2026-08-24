export const colors = {
  primary: '#2F7CD8',
  primaryLight: '#E3EDFA',
  primarySoft: '#EDF3FB',
  primaryDark: '#1E5FB0',

  purple: '#7258B5',
  purpleLight: '#F0EBFA',

  amber: '#B0782B',
  amberLight: '#FBF3E4',

  coral: '#D85A30',
  coralLight: '#FAECE7',

  danger: '#C84B4B',
  dangerLight: '#FCEAEA',

  warning: '#B0782B',
  warningLight: '#FBF3E4',

  success: '#218A5B',
  successLight: '#E4F4EC',

  // Neutrals
  bg: '#F4F8FD',
  surface: '#FFFFFF',
  border: '#D6E1F0',
  borderSoft: '#E4ECF6',
  borderStrong: '#B9CBE2',

  textPrimary: '#17335B',
  textSecondary: '#41546F',
  textMuted: '#5B6B82',
  textFaint: '#8FA6C4',

  white: '#FFFFFF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
};

// buttonShape = "Rounded" (owner decision 2026-07-16, DECISIONS.md) — buttons
// use radius.md app-wide, not radius.full pills, including future restyles.
export const buttonRadius = radius.md;

export const fonts = {
  regular: 'Lato_400Regular',
  bold: 'Lato_700Bold',
  black: 'Lato_900Black',
};

export const typography = {
  h1: { fontSize: 24, fontFamily: fonts.black, color: colors.textPrimary },
  h2: { fontSize: 20, fontFamily: fonts.bold, color: colors.textPrimary },
  h3: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  body: { fontSize: 15, fontFamily: fonts.regular, color: colors.textPrimary },
  bodySmall: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary },
  caption: { fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
};
