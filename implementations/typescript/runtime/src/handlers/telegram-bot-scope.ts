/** Global lookup is required at webhook ingress, before the account is known.
 * Authenticated functions must only receive a bot belonging to their account. */
export async function findAccountBot<T extends { id: string; accountId: string }>(
  accountId: string | undefined,
  botId: unknown,
  find: (botId: string) => Promise<T | null>,
): Promise<T | null> {
  if (!accountId || typeof botId !== "string" || !botId) return null;
  const bot = await find(botId);
  return bot?.id === botId && bot.accountId === accountId ? bot : null;
}
