import { callTelegram, type TelegramResponse } from "./telegram-client";

/** Irreducible provider boundary for the declared Result String Unit leaf. */
export async function deleteTelegramWebhook(
  token: unknown,
  request: (token: string, method: string, params: Record<string, unknown>) => Promise<TelegramResponse> = callTelegram,
): Promise<{ $tag: "Ok"; _0: null } | { $tag: "Err"; _0: string }> {
  if (typeof token !== "string" || !token) return { $tag: "Err", _0: "token required" };
  try {
    const response = await request(token, "deleteWebhook", {});
    return response.ok
      ? { $tag: "Ok", _0: null }
      : { $tag: "Err", _0: `deleteWebhook failed (${response.error_code}): ${response.description}` };
  } catch {
    // Transport errors may contain the token-bearing request URL. Keep that
    // detail out of the persisted typed error and the dashboard result.
    return { $tag: "Err", _0: "deleteWebhook request failed. Retry when the provider is reachable." };
  }
}
