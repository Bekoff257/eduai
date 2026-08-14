/** Not exhaustive — business_settings.languages/default_language are both
 * plain text (array/string) columns, not constrained to only these values,
 * so a business can be configured with additional languages directly via
 * the API/database later without a schema change. This is a convenience
 * shortlist for the dashboard's language checkboxes, covering this app's
 * documented minimum (Uzbek, Russian, English) — matches the language
 * names used in src/lib/ai/system-prompt.ts's LANGUAGE_NAMES map. */
export const COMMON_LANGUAGES = [
  { code: "uz", label: "Uzbek" },
  { code: "ru", label: "Russian" },
  { code: "en", label: "English" },
] as const;
