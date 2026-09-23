import React from 'react';
import Svg, {Path, Rect, Circle} from 'react-native-svg';

export type ProofUiIconName =
  | 'organization' | 'identity' | 'country' | 'document' | 'id-card'
  | 'age' | 'region' | 'laboratory' | 'qr' | 'shield' | 'eye-off'
  | 'info' | 'arrow-left' | 'chevron-right' | 'chevron-down' | 'search' | 'lock'
  | 'wallet' | 'copy' | 'check' | 'history' | 'download' | 'trash' | 'sun' | 'moon'
  | 'settings' | 'refresh' | 'share' | 'arrow-right' | 'close';

/** Outlined pictograms shared by the proof catalog and request review. */
export function ProofUiIcon({name, size = 24, color}: {
  name: ProofUiIconName; size?: number; color: string;
}) {
  const icons: Record<ProofUiIconName, React.ReactNode> = {
    organization: <><Path d="M3 21h18M5 21V7l8-4v18M13 8h6v13M8 8v1m0 3v1m0 3v1m3-10v1m0 3v1m0 3v1m5-5v1m0 3v1" /></>,
    identity: <><Circle cx="9" cy="7" r="4" /><Path d="M2 21v-2a7 7 0 0 1 11-5.75M15 17l3 3 5-6" /></>,
    country: <><Circle cx="12" cy="12" r="9" /><Path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18" /></>,
    document: <><Path d="M6 3h9l4 4v14H6zM14 3v5h5M9 11h7M9 15h7M9 18h5" /></>,
    'id-card': <><Rect x="2" y="5" width="20" height="14" rx="2" /><Circle cx="8" cy="10" r="2" /><Path d="M4.5 16a3.5 3.5 0 0 1 7 0M15 9h4M15 12h4M15 15h3" /></>,
    age: <><Rect x="3" y="5" width="18" height="16" rx="2" /><Path d="M7 2v6M17 2v6M3 11h18M7 15h3M14 15h3M7 18h3" /></>,
    region: <><Path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z" /><Circle cx="12" cy="10" r="2.5" /></>,
    laboratory: <><Path d="M9 2h6M10 2v7L3.5 19.5A1.6 1.6 0 0 0 5 22h14a1.6 1.6 0 0 0 1.5-2.5L14 9V2M7.5 14h9" /><Circle cx="10" cy="18" r=".6" /><Circle cx="14" cy="17" r=".5" /></>,
    qr: <><Rect x="3" y="3" width="6" height="6" /><Rect x="15" y="3" width="6" height="6" /><Rect x="3" y="15" width="6" height="6" /><Path d="M15 15h3v3h3v3h-6v-3M21 14v1" /></>,
    shield: <><Path d="M12 2 3.5 6v6c0 5 8.5 10 8.5 10s8.5-5 8.5-10V6zM8 12l3 3 5-6" /></>,
    'eye-off': <><Path d="m3 3 18 18M10.5 5.2c.5-.1 1-.2 1.5-.2 6 0 10 7 10 7a20 20 0 0 1-3 3.6M6 6.3A23 23 0 0 0 2 12s4 7 10 7c1.8 0 3.4-.6 4.8-1.5M10 10a3 3 0 0 0 4 4" /></>,
    info: <><Circle cx="12" cy="12" r="9" /><Path d="M12 11v6M12 7v.1" /></>,
    'arrow-left': <Path d="M20 12H4m6-6-6 6 6 6" />,
    'chevron-right': <Path d="m9 5 7 7-7 7" />,
    'chevron-down': <Path d="m5 9 7 7 7-7" />,
    search: <><Circle cx="10" cy="10" r="7" /><Path d="m15 15 6 6" /></>,
    lock: <><Rect x="5" y="10" width="14" height="11" rx="2" /><Path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    wallet: <><Path d="M20 7V4H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V7M21 13h-6v5h6" /><Circle cx="17" cy="15.5" r=".5" /></>,
    copy: <><Rect x="8" y="8" width="13" height="13" rx="2" /><Path d="M16 5V3H3v13h2" /></>,
    history: <><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></>,
    download: <><Path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    trash: <><Path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    sun: <><Circle cx="12" cy="12" r="4" /><Path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l1.5 1.5m13 13L20 20M4 20l1.5-1.5m13-13L20 4" /></>,
    moon: <Path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z" />,
    settings: <><Path d="M4 7h16M4 17h16" /><Circle cx="9" cy="7" r="3" /><Circle cx="15" cy="17" r="3" /></>,
    refresh: <><Path d="M21 3v6h-6M3 21v-6h6M4.5 8a8 8 0 0 1 13-4L21 9M3 15l3.5 5a8 8 0 0 0 13-4" /></>,
    share: <><Circle cx="18" cy="4" r="3" /><Circle cx="6" cy="12" r="3" /><Circle cx="18" cy="20" r="3" /><Path d="m8.5 10.5 7-5m-7 8 7 5" /></>,
    'arrow-right': <Path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <Path d="m6 6 12 12M6 18 18 6" />,
    check: <Path d="m4 12 5 5L20 6" />,
  };
  const drawing = icons[name];
  if (!drawing) throw new Error(`Unknown proof icon '${name}'.`);
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round"
    accessible={false}>{drawing}</Svg>;
}
