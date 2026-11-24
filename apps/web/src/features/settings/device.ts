// A session's device, named from its User-Agent the way people say it: "Safari on macOS".

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Chrome\/|CriOS\/|Chromium\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

const first = (table: readonly (readonly [RegExp, string])[], text: string) =>
  table.find(([pattern]) => pattern.test(text))?.[1];

/** "Browser on System", one of them alone, or "Unknown device". */
export const deviceName = (userAgent: string | null | undefined): string => {
  const text = userAgent ?? "";
  const browser = first(BROWSERS, text);
  const system = first(SYSTEMS, text);
  if (browser !== undefined && system !== undefined) {
    return `${browser} on ${system}`;
  }
  return browser ?? system ?? "Unknown device";
};
