/** Not exhaustive — the dashboard doesn't restrict input to only these
 * (courses.currency and business_settings.default_currency are both plain
 * text columns), just a convenience shortlist for the currency <select>s
 * so a business owner isn't forced to remember/type an ISO code. Covers
 * this app's actual customer base (Uzbekistan-focused, per the education-
 * center seed/production data) plus common regional and international
 * currencies. */
export const COMMON_CURRENCIES = [
  { code: "UZS", label: "UZS — Uzbek so'm" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "RUB", label: "RUB — Russian Ruble" },
  { code: "KZT", label: "KZT — Kazakhstani Tenge" },
  { code: "GBP", label: "GBP — British Pound" },
] as const;
