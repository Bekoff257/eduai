/**
 * Deterministic, dependency-free language detection for the 3 languages
 * this app's customer base actually uses (Uzbek, Russian, English) — NOT a
 * general-purpose language ID library, and deliberately not an OpenRouter
 * call (see docs/architecture.md's Milestone 5 section for why: language
 * detection doesn't need a model, and spending a request on it per message
 * would add latency/cost for no accuracy benefit over simple heuristics).
 *
 * Returns null rather than a guess when the signal is too weak (short
 * messages, pure numbers/emoji, a bare course name like "IELTS") — callers
 * are expected to fall back to the customer's previously known language or
 * the business's configured default rather than trust a low-confidence
 * detection. See resolveCustomerLanguage in services/customers.ts for that
 * fallback chain.
 */

export type DetectableLanguage = "uz" | "ru" | "en";

const CYRILLIC_RE = /[Ѐ-ӿ]/g;
const LATIN_LETTER_RE = /[a-zA-Z]/g;

// Small, hand-picked keyword/stopword lists — not exhaustive, just common
// enough words in short customer-service messages to be a useful signal.
// Includes the apostrophe-letter digraphs (o', g') that are distinctively
// Uzbek-Latin and rarely appear in English text. Deliberately excludes
// very short/common tokens (single letters, "hi", "no", "do", "is") that
// would false-positive as SUBSTRINGS of unrelated words (e.g. "hi" inside
// "this", "i" inside "ielts") now that matching is whole-word (see
// countMarkers) — short function words are also weak signal on their own.
const UZ_LATIN_MARKERS = [
  "salom", "assalomu", "rahmat", "qancha", "narxi", "kerak", "bo'ladi",
  "qachon", "qanday", "kurs", "kursi", "yoq", "iltimos", "necha",
  "haqida", "uchun", "bilan", "menga", "sizga", "bormi", "tayyor",
];
const EN_MARKERS = [
  "hello", "thanks", "thank", "please", "how", "much", "what",
  "when", "course", "price", "cost", "need", "want", "available", "yes",
  "the", "are", "you", "can",
];

function countMarkers(lowerText: string, markers: string[]): number {
  let count = 0;
  for (const marker of markers) {
    // Whole-word match (regex word boundaries) — a plain substring check
    // would match "i" inside "ielts" or "hi" inside "this", which made
    // short/common markers produce false-positive detections on messages
    // that don't actually contain that word.
    const re = new RegExp(`\\b${marker.replace(/'/g, "'?")}\\b`, "i");
    if (re.test(lowerText)) count++;
  }
  return count;
}

/**
 * Detects uz/ru/en from a single message's text, or null if there isn't
 * enough signal to be reasonably confident. Never throws.
 */
export function detectLanguage(text: string): DetectableLanguage | null {
  const trimmed = text.trim();
  if (trimmed.length < 2) return null;

  const cyrillicCount = (trimmed.match(CYRILLIC_RE) ?? []).length;
  const latinCount = (trimmed.match(LATIN_LETTER_RE) ?? []).length;
  const totalLetters = cyrillicCount + latinCount;

  // No alphabetic content at all (pure digits, punctuation, emoji, a bare
  // course code) — nothing to detect from.
  if (totalLetters === 0) return null;

  // Cyrillic-dominant text: treated as Russian. Uzbek CAN be written in
  // Cyrillic historically, but this app's actual Telegram customer base
  // overwhelmingly uses Latin-script Uzbek or Russian for the Cyrillic
  // case — documented simplification, not a claim of perfect script
  // detection (see module doc comment).
  if (cyrillicCount / totalLetters > 0.5) {
    return "ru";
  }

  // Latin-dominant: score against Uzbek vs English marker lists. Requires
  // at least one real hit to avoid a false-confident result on a short or
  // ambiguous message (e.g. "IELTS", "OK", a phone number with letters).
  const lower = trimmed.toLowerCase();
  const uzScore = countMarkers(lower, UZ_LATIN_MARKERS);
  const enScore = countMarkers(lower, EN_MARKERS);

  if (uzScore === 0 && enScore === 0) return null;
  if (uzScore > enScore) return "uz";
  if (enScore > uzScore) return "en";
  // Tied and both non-zero — genuinely ambiguous (e.g. a message that's
  // just "hi" could be either community's greeting-adjacent word); don't
  // guess.
  return null;
}

// Phrase patterns for an EXPLICIT language request — narrow and specific by
// design (per the "no giant translation/RAG system" constraint), not a
// model call. Each entry maps a regex to the language it requests. Ordered
// checks, not exhaustive natural-language understanding — a customer
// phrasing the request in an unlisted way simply won't trigger an explicit
// override and instead falls through to normal detection, which is a safe
// default (not a broken one).
const EXPLICIT_REQUEST_PATTERNS: Array<{ pattern: RegExp; language: DetectableLanguage }> = [
  { pattern: /отвеча(й|йте)\s+(мне\s+)?на\s+русск/i, language: "ru" },
  { pattern: /говор(и|ите)\s+по-русски/i, language: "ru" },
  { pattern: /перейд(и|ите)\s+на\s+русский/i, language: "ru" },
  { pattern: /o'zbekcha\s+(javob|gapir|yoz)/i, language: "uz" },
  { pattern: /o'zbek\s+tilida\s+(javob|gapir|yoz)/i, language: "uz" },
  { pattern: /\bspeak\s+english\b/i, language: "en" },
  { pattern: /\banswer\s+(me\s+)?in\s+english\b/i, language: "en" },
  { pattern: /\breply\s+in\s+english\b/i, language: "en" },
  { pattern: /\bswitch\s+to\s+english\b/i, language: "en" },
];

/**
 * Detects an EXPLICIT request to use a specific language (e.g. "Отвечайте
 * мне на русском" / "o'zbekcha gapiring" / "speak English") — distinct from
 * ordinary detectLanguage(), which infers language from whatever script/
 * words the customer happens to be using. An explicit request is a
 * deliberate, permanent instruction (per resolveCustomerLanguage's
 * precedence rules), so this intentionally matches a narrow set of
 * unambiguous phrasings rather than trying to infer intent from arbitrary
 * text.
 */
export function detectExplicitLanguageRequest(text: string): DetectableLanguage | null {
  for (const { pattern, language } of EXPLICIT_REQUEST_PATTERNS) {
    if (pattern.test(text)) return language;
  }
  return null;
}
