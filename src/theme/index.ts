export const colors = {
  background: {
    primary: '#0F1419',
    secondary: '#1A2332',
    tertiary: '#232D3F',
  },
  border: {
    primary: '#2D3748',
    secondary: '#3D4A5C',
  },
  text: {
    primary: '#FFFFFF',
    secondary: '#9CA3AF',
    tertiary: '#6B7280',
    disabled: '#4B5563',
  },
  success: {
    400: '#34D399',
    500: '#10B981',
    600: '#059669',
    background: 'rgba(16, 185, 129, 0.13)',
  },
  warning: {
    400: '#FBBF24',
    500: '#F59E0B',
    600: '#D97706',
    background: 'rgba(245, 158, 11, 0.13)',
  },
  info: {
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    background: 'rgba(59, 130, 246, 0.13)',
  },
  error: {
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    background: 'rgba(239, 68, 68, 0.13)',
  },
  wallets: {
    metamask: '#E2761B',
    coinbase: '#0052FF',
    trust: '#0500FF',
    walletconnect: '#3B99FC',
  },
} as const;

export const typography = {
  display: {
    large: {
      fontFamily: 'SF Pro Display',
      fontSize: 32,
      fontWeight: '700' as const,
      lineHeight: 40,
      letterSpacing: -0.5,
    },
    medium: {
      fontFamily: 'SF Pro Display',
      fontSize: 28,
      fontWeight: '700' as const,
      lineHeight: 36,
      letterSpacing: -0.5,
    },
  },
  heading: {
    h1: {
      fontFamily: 'SF Pro Display',
      fontSize: 24,
      fontWeight: '700' as const,
      lineHeight: 32,
      letterSpacing: -0.25,
    },
    h2: {
      fontFamily: 'SF Pro Display',
      fontSize: 20,
      fontWeight: '600' as const,
      lineHeight: 28,
      letterSpacing: -0.25,
    },
    h3: {
      fontFamily: 'SF Pro Display',
      fontSize: 18,
      fontWeight: '600' as const,
      lineHeight: 26,
      letterSpacing: 0,
    },
  },
  body: {
    large: {
      fontFamily: 'SF Pro Text',
      fontSize: 17,
      fontWeight: '400' as const,
      lineHeight: 24,
      letterSpacing: 0,
    },
    medium: {
      fontFamily: 'SF Pro Text',
      fontSize: 16,
      fontWeight: '400' as const,
      lineHeight: 24,
      letterSpacing: 0,
    },
    small: {
      fontFamily: 'SF Pro Text',
      fontSize: 15,
      fontWeight: '400' as const,
      lineHeight: 22,
      letterSpacing: 0,
    },
  },
  caption: {
    default: {
      fontFamily: 'SF Pro Text',
      fontSize: 14,
      fontWeight: '400' as const,
      lineHeight: 20,
      letterSpacing: 0.1,
    },
    small: {
      fontFamily: 'SF Pro Text',
      fontSize: 13,
      fontWeight: '400' as const,
      lineHeight: 18,
      letterSpacing: 0.1,
    },
  },
  small: {
    fontFamily: 'SF Pro Text',
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  tiny: {
    fontFamily: 'SF Pro Text',
    fontSize: 11,
    fontWeight: '500' as const,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  mono: {
    medium: {
      fontFamily: 'SF Mono',
      fontSize: 14,
      fontWeight: '400' as const,
      lineHeight: 20,
      letterSpacing: 0.5,
    },
    small: {
      fontFamily: 'SF Mono',
      fontSize: 12,
      fontWeight: '400' as const,
      lineHeight: 16,
      letterSpacing: 0.5,
    },
  },
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

export const gap = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

export const borderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

export const borderWidth = {
  none: 0,
  thin: 1,
  medium: 1.5,
  thick: 2,
} as const;

export const shadows = {
  button: {
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  buttonPressed: {
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  modal: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 8,
  },
  toggle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
} as const;

export const opacity = {
  disabled: 0.38,
  overlayLight: 0.08,
  overlayMedium: 0.16,
  overlayHeavy: 0.32,
  overlayModal: 0.72,
  divider: 0.12,
} as const;

export const animation = {
  duration: {
    instant: 0,
    fast: 100,
    normal: 200,
    slow: 300,
    slower: 400,
    slowest: 500,
  },
  easing: {
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 0.5)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

export const sizing = {
  icon: {
    xs: 12,
    sm: 16,
    md: 20,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
    hero: 80,
  },
  touchTarget: 44,
  buttonHeight: {
    large: 52,
    medium: 44,
    small: 40,
  },
  inputHeight: 52,
  toggleWidth: 51,
  toggleHeight: 31,
  toggleThumb: 27,
} as const;

export const screen = {
  width: 393,
  height: 852,
  statusBar: 44,
  navHeader: 52,
  tabBar: 83,
  tabBarContent: 49,
  homeIndicator: 34,
  contentPadding: 16,
} as const;

export const gradient = {
  primary: 'linear-gradient(135deg, #1A2332 0%, #0F1419 100%)',
  accent: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
  success: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
  gold: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
  progressFill: 'linear-gradient(90deg, #10B981 0%, #34D399 100%)',
  shimmer: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
} as const;

export const theme = {
  colors,
  typography,
  spacing,
  gap,
  borderRadius,
  borderWidth,
  shadows,
  opacity,
  animation,
  sizing,
  screen,
  gradient,
} as const;

export default theme;
