/** A suggestion row shows its title, then a sentence saying what the result is.
 * When the sentence only repeats the title ("Group by date" / "grouped by date",
 * or with the subject added, "Transactions grouped by date"), the second line
 * is noise: one of the two must go. The sentence stays whenever it says
 * something the title does not ("Sum by key" / "Sum of amount per person"). */
const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
// "grouped" and "group", "reverse" and "reversed", "items" and "item" count as one word.
const stem = (word: string): string => {
  const root = word.length > 4 && word.endsWith("ed") ? word.slice(0, -2)
    : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
  return root.length > 3 && root.endsWith("e") ? root.slice(0, -1) : root;
};

export function sentenceRepeatsLabel(sentence: string, label: string): boolean {
  const labelWords = new Set(words(label).map(stem));
  const sentenceWords = new Set(words(sentence).map(stem));
  if (labelWords.size === 0 || sentenceWords.size === 0) return false;
  for (const word of labelWords) if (!sentenceWords.has(word)) return false;
  // At most the subject is new ("Transactions grouped by date").
  let added = 0;
  for (const word of sentenceWords) if (!labelWords.has(word)) added++;
  return added <= 1;
}
