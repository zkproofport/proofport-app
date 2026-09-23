import {useThemeColors} from '../context/ThemeContext';

/** Colors of the supplied proof-screen reference; light mode keeps its hierarchy. */
export function useProofUiColors() {
  const {mode} = useThemeColors();
  if (mode === 'light') {
    return {
      background: '#F4F6F8', card: '#FFFFFF', inset: '#F0F3F5', border: '#DCE2E7',
      text: '#17232F', secondary: '#5C6A78', muted: '#7B8894', blue: '#3186F7', gold: '#A77417', green: '#16845B', red: '#C13645',
    };
  }
  return {
    background: '#0D1922', card: '#192732', inset: '#1D2C38', border: '#2D3C49',
    text: '#F2F5F8', secondary: '#A6B3C0', muted: '#7D8D9D', blue: '#3186F7', gold: '#E5B84B', green: '#54C99A', red: '#F08089',
  };
}
