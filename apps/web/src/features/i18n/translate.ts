import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatRelative,
} from "../shell/format";
import type { Locale } from "./locale";
import { en, type Message, type MessageKey } from "./messages/en";
import { zhCN } from "./messages/zh-CN";

/** The words of each language, by key. TypeScript checks that Chinese has every English key. */
export const MESSAGES: Record<Locale, Record<MessageKey, Message>> = { en, "zh-CN": zhCN };

/** The names in a message's braces, such as `name` in "Delete {name}?". */
type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

type MessageText<M> = M extends string ? M : M extends { other: infer O } ? O | M[keyof M] : never;

/** The values a message takes: one per placeholder, and `count` for a message with plural forms. */
export type ParamsOf<K extends MessageKey> = (typeof en)[K] extends string
  ? Record<Placeholders<(typeof en)[K]>, string | number>
  : Record<Exclude<Placeholders<MessageText<(typeof en)[K]>>, "count">, string | number> & {
      count: number;
    };

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * A key's values: none for a message without placeholders, else one per placeholder. A key chosen
 * at run time from several, such as a table's, takes whatever values its messages need.
 */
type Args<K extends MessageKey> =
  true extends IsUnion<K>
    ? [params?: Record<string, string | number>]
    : [Placeholders<MessageText<(typeof en)[K]>>] extends [never]
      ? []
      : [params: ParamsOf<K>];

const PLACEHOLDER = /\{(\w+)\}/g;

/** The words of `message` in `locale`, with each placeholder replaced by its value. */
export const formatMessage = (
  locale: Locale,
  message: Message,
  params: Record<string, string | number> = {},
): string => {
  const text =
    typeof message === "string"
      ? message
      : new Intl.PluralRules(locale).select(Number(params.count)) === "one"
        ? (message.one ?? message.other)
        : message.other;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) {
      return whole;
    }
    return typeof value === "number" ? formatCount(value, locale) : value;
  });
};

/** The Dashboard's words and formats in one language. */
export interface Translator {
  <K extends MessageKey>(key: K, ...args: Args<K>): string;
  readonly locale: Locale;
  /** A count, such as 1,024 or 1,024. */
  count: (value: number) => string;
  /** A size in decimal units, such as 1.5 MB. */
  bytes: (value: number) => string;
  /** How long ago or ahead, such as "2 minutes ago" or "2 分钟前". */
  relative: (iso: string, now?: Date) => string;
  date: (iso: string) => string;
  dateTime: (iso: string) => string;
  /** Items joined as the language joins a list, such as "a, b and c" or "a、b和c". */
  list: (items: readonly string[]) => string;
}

const create = (locale: Locale): Translator => {
  const messages = MESSAGES[locale];
  const translate = (key: MessageKey, params?: Record<string, string | number>) =>
    formatMessage(locale, messages[key], params);
  return Object.assign(translate, {
    locale,
    count: (value: number) => formatCount(value, locale),
    bytes: (value: number) => formatBytes(value, locale),
    relative: (iso: string, now?: Date) => formatRelative(iso, locale, now),
    date: (iso: string) => formatDate(iso, locale),
    dateTime: (iso: string) => formatDateTime(iso, locale),
    list: (items: readonly string[]) =>
      new Intl.ListFormat(locale, { type: "conjunction" }).format(items),
  });
};

const translators = new Map<Locale, Translator>();

/** The translator for `locale`, the same object on every call. */
export const translator = (locale: Locale): Translator => {
  let found = translators.get(locale);
  if (found === undefined) {
    found = create(locale);
    translators.set(locale, found);
  }
  return found;
};
