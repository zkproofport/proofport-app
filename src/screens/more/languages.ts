export const LANGUAGE_OPTIONS = [
  {value: 'en', label: 'English'},
  {value: 'ko', label: '한국어'},
] as const;
export type AppLanguage = typeof LANGUAGE_OPTIONS[number]['value'];

export function languageOption(language: string) {
  const code = language.split('-')[0];
  const option = LANGUAGE_OPTIONS.find(item => item.value === code);
  if (!option) throw new Error(`Unknown language '${language}'. Known: en, ko.`);
  return option;
}
