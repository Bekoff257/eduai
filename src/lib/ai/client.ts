import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * OpenRouter client (OpenAI-compatible API). This is the ONLY place the
 * AI provider is instantiated — never construct OpenAI/OpenRouter clients
 * elsewhere, and never expose this key to the browser.
 */
export function getOpenRouterClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }

  client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  return client;
}

export const AI_MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
