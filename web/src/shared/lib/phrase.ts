import type { MessageId } from "../../strings/StringsProvider.tsx";

/**
 * Words to show, as the logic decides them and before any language does: a message from the
 * catalog with its values, or text that is nobody's to translate, such as a name an agent chose.
 *
 * Logic returns these instead of English, so the screen picks the words and a test can check the
 * decision without a translation in the way.
 */
export type Phrase =
  | { readonly id: MessageId; readonly values?: Readonly<Record<string, string | number>> }
  | { readonly text: string };

export const phrase = (id: MessageId, values?: Readonly<Record<string, string | number>>): Phrase =>
  values === undefined ? { id } : { id, values };
