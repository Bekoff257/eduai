import "server-only";

/**
 * Strips Markdown syntax the model sometimes emits (**bold**, *italic*,
 * __underline__, `code`, # headings, etc) before a reply reaches Telegram.
 * sendTelegramMessage() sends with no parse_mode, so Telegram renders text
 * as fully literal — any Markdown the model writes would otherwise show up
 * to the customer as raw asterisks/underscores rather than being rendered.
 * Switching to parse_mode: "MarkdownV2" instead would require escaping
 * every one of Telegram's reserved characters in the model's free-form
 * output, which is more failure-prone than simply not rendering formatting
 * at all — this app's replies have never depended on bold/italic to be
 * understood.
 *
 * Deliberately only applied to AI-generated text, not staff-typed replies
 * (src/app/api/conversations/[conversationId]/messages/route.ts) — a human
 * typing "*" meant it, and stripping their own message would be surprising.
 */
export function stripMarkdownForTelegram(text: string): string {
  return (
    text
      // Bold+italic (***text*** or ___text___) -> plain
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/___(.+?)___/g, "$1")
      // Bold (**text** or __text__) -> plain
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      // Italic (*text* or _text_) -> plain. Requires a non-space character
      // immediately inside the markers so mid-word underscores (variable_
      // names) and stray single asterisks aren't mistaken for emphasis.
      .replace(/\*(\S(?:[^*]*\S)?)\*/g, "$1")
      .replace(/(?<![a-zA-Z0-9])_(\S(?:[^_]*\S)?)_(?![a-zA-Z0-9])/g, "$1")
      // Inline code (`text`) -> plain
      .replace(/`([^`]+)`/g, "$1")
      // Heading markers at the start of a line ("# ", "## ", ...) -> plain
      .replace(/^#{1,6}\s+/gm, "")
      // Strikethrough (~~text~~) -> plain
      .replace(/~~(.+?)~~/g, "$1")
  );
}
