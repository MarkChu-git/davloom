/**
 * happy-dom runs the first-paint script, which is Davloom's own, as a browser runs it from <head>.
 * @vitest-environment-options {"settings": {"enableJavaScriptEvaluation": true}}
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, LocaleFrames, useT } from "./I18nProvider";
import { LanguageSwitch } from "./LanguageSwitch";
import {
  browserLanguages,
  isLanguageChoice,
  isLocale,
  LOCALES,
  localeFromLanguages,
  resolveLocale,
  type LanguageChoice,
} from "./locale";
import { ASTRYX_ZH_CN_EXTRA } from "./messages/astryx-zh-CN";
import { en, type Message, type MessageKey } from "./messages/en";
import { pageText, type PageId } from "./pages";
import { RichText } from "./RichText";
import { applyLanguage, LANGUAGE_STORAGE_KEY, languageScript } from "./script";
import { setLanguageChoice, useActiveLocale, useLanguageChoice } from "./store";
import { formatMessage, MESSAGES, translator } from "./translate";
import ASTRYX_EN from "@astryxdesign/core/locales/en.generated.js";

const KEYS = Object.keys(en).filter((key): key is MessageKey => key in en);

/** Every text of a message: the string, or each plural form. */
const formsOf = (message: Message): string[] =>
  typeof message === "string"
    ? [message]
    : [...(message.one === undefined ? [] : [message.one]), message.other];

const placeholdersOf = (message: Message): string[] =>
  [
    ...new Set(
      formsOf(message).flatMap((form) => [...form.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "")),
    ),
  ].toSorted();

const tagsOf = (message: Message): string[] =>
  [
    ...new Set(
      formsOf(message).flatMap((form) => [...form.matchAll(/<\/?(\w+)>/g)].map((m) => m[0])),
    ),
  ].toSorted();

const setLanguages = (languages: readonly string[]) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
};

beforeEach(() => {
  localStorage.clear();
  setLanguageChoice("system");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("lang");
});

describe("choosing the language", () => {
  it.each([
    [["zh-CN"], "zh-CN"],
    [["zh"], "zh-CN"],
    [["zh-TW", "en"], "zh-CN"],
    [["zh-Hant-HK"], "zh-CN"],
    [["ZH-cn"], "zh-CN"],
    [["en-US", "zh-CN"], "zh-CN"],
    [["en-GB"], "en"],
    [["ja", "ko"], "en"],
    [["zu"], "en"],
    [["zhx"], "en"],
    [[], "en"],
  ])("reads the browser's %j as %s", (languages, locale) => {
    expect(localeFromLanguages(languages)).toBe(locale);
  });

  it("follows the browser for System, and the choice otherwise", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (languages) => {
        expect(resolveLocale("system", languages)).toBe(localeFromLanguages(languages));
        expect(resolveLocale("en", languages)).toBe("en");
        expect(resolveLocale("zh-CN", languages)).toBe("zh-CN");
      }),
    );
  });

  it.each([
    ["en", true, true],
    ["zh-CN", true, true],
    ["system", true, false],
    ["zh", false, false],
    ["", false, false],
  ])("counts %j as a choice: %s, and as a language: %s", (value, isChoice, isLanguage) => {
    expect(isLanguageChoice(value)).toBe(isChoice);
    expect(isLocale(value)).toBe(isLanguage);
  });
});

describe("the dictionaries", () => {
  it("hold the same keys in both languages", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).toSorted()).toEqual(KEYS.toSorted());
    }
  });

  // A separator may be nothing: Chinese runs a chart's words together.
  it.each(LOCALES)("leave no text empty in %s, but for a separator", (locale) => {
    for (const key of KEYS.filter((name) => !name.endsWith(".separator"))) {
      for (const form of formsOf(MESSAGES[locale][key])) {
        expect(form.trim(), `${locale} ${key}`).not.toBe("");
      }
    }
  });

  it("give Chinese the placeholders and tags of English", () => {
    for (const key of KEYS) {
      expect(placeholdersOf(MESSAGES["zh-CN"][key]), key).toEqual(placeholdersOf(en[key]));
      expect(tagsOf(MESSAGES["zh-CN"][key]), key).toEqual(tagsOf(en[key]));
    }
  });

  it("give English both forms of a plural message, and Chinese its one", () => {
    for (const key of KEYS) {
      const message = en[key];
      if (typeof message !== "string") {
        expect(message, key).toHaveProperty("one");
        expect(typeof MESSAGES["zh-CN"][key], key).toBe("object");
      }
    }
  });

  // Latin words in Chinese are names, commands and examples that English writes the same.
  it("write Chinese in Chinese, apart from what English writes the same", () => {
    const leftovers = KEYS.filter((key) => {
      const english = formsOf(en[key]).join(" ");
      return formsOf(MESSAGES["zh-CN"][key]).some((form) =>
        (form.replace(/\{\w+\}|<\/?\w+>/g, "").match(/[A-Za-z][\w.@/:-]*/g) ?? []).some(
          (word) => !english.includes(word),
        ),
      );
    });
    expect(leftovers.map((key) => `${key}: ${JSON.stringify(MESSAGES["zh-CN"][key])}`)).toEqual([]);
  });
});

/** The values an ICU message names, such as `count` in "{count, number} selected". */
const icuNames = (words: string) => [...words.matchAll(/\{(\w+)/g)].map((match) => match[1]);

describe("Astryx's words", () => {
  it("give Astryx's words that its Chinese lacks, with no value its English does not have", () => {
    for (const [key, text] of Object.entries(ASTRYX_ZH_CN_EXTRA)) {
      const english = ASTRYX_EN[key];
      expect(english, key).toBeTypeOf("string");
      for (const name of icuNames(text)) {
        expect(icuNames(String(english)), key).toContain(name);
      }
    }
  });
});

describe("formatMessage", () => {
  it("fills placeholders and formats numbers for the language", () => {
    expect(formatMessage("en", "Delete {name}?", { name: "a" })).toBe("Delete a?");
    expect(formatMessage("en", "{n} items", { n: 12_345 })).toBe("12,345 items");
    expect(formatMessage("zh-CN", "{n} 项", { n: 12_345 })).toBe("12,345 项");
  });

  it("leaves a placeholder without a value as it is", () => {
    expect(formatMessage("en", "Hello {name}")).toBe("Hello {name}");
  });

  it.each([
    ["en", 0, "0 files"],
    ["en", 1, "1 file"],
    ["en", 2, "2 files"],
    ["zh-CN", 1, "1 个文件"],
    ["zh-CN", 2, "2 个文件"],
  ] as const)("in %s counts %i as %s", (locale, count, text) => {
    expect(translator(locale)("count.files", { count })).toBe(text);
  });

  it("falls back to the other form when a language lacks the one it picks", () => {
    expect(formatMessage("en", { other: "{count} things" }, { count: 1 })).toBe("1 things");
  });
});

describe("the translator", () => {
  it("is the same object for a language on every call", () => {
    expect(translator("zh-CN")).toBe(translator("zh-CN"));
    expect(translator("en").locale).toBe("en");
  });

  it.each([
    ["en", "1.5 MB", "1,024", "a, b, and c"],
    ["zh-CN", "1.5 MB", "1,024", "a、b和c"],
  ] as const)("formats in %s", (locale, bytes, count, list) => {
    const t = translator(locale);
    expect(t.bytes(1_500_000)).toBe(bytes);
    expect(t.count(1024)).toBe(count);
    expect(t.list(["a", "b", "c"])).toBe(list);
    expect(t.date("2026-11-24T12:00:00Z")).not.toBe("");
    expect(t.dateTime("2026-11-24T12:00:00Z")).not.toBe("");
    expect(t.relative("2026-11-24T12:00:00Z", new Date("2026-11-24T12:05:00Z"))).toBe(
      locale === "en" ? "5 minutes ago" : "5分钟前",
    );
  });
});

describe("pages", () => {
  const PAGES: (PageId | undefined)[] = [
    "overview",
    "files",
    "credentials",
    "storage",
    "settings",
    "signIn",
    "register",
    undefined,
  ];

  it.each(LOCALES)("each name themselves in %s", (locale) => {
    const titles = PAGES.map((page) => pageText(page, locale).title);
    expect(new Set(titles).size).toBe(PAGES.length);
    for (const page of PAGES) {
      expect(pageText(page, locale).description).not.toBe("");
    }
  });

  it("read Davloom in either language", () => {
    expect(pageText("files", "en").title).toBe("Files | Davloom");
    expect(pageText("files", "zh-CN").title).toBe("文件 | Davloom");
  });
});

const Probe = () => (
  <p>
    {useLanguageChoice()} {useActiveLocale()}
  </p>
);

describe("the language store", () => {
  it.each<[LanguageChoice, string | null, string]>([
    ["en", "en", "en"],
    ["zh-CN", "zh-CN", "zh-CN"],
  ])("keeps %s in storage as %j and on <html> as %s", (choice, stored, lang) => {
    render(<Probe />);
    act(() => setLanguageChoice(choice));
    expect(screen.getByText(`${choice} ${lang}`)).toBeTruthy();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(stored);
    expect(document.documentElement.lang).toBe(lang);
  });

  it("forgets the choice for System, and follows the browser", () => {
    setLanguages(["zh-TW"]);
    act(() => setLanguageChoice("en"));
    render(<Probe />);
    act(() => setLanguageChoice("system"));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(screen.getByText("system zh-CN")).toBeTruthy();
  });

  it("follows the browser when its languages change", () => {
    setLanguages(["en-US"]);
    render(<Probe />);
    act(() => setLanguageChoice("system"));
    expect(screen.getByText("system en")).toBeTruthy();
    setLanguages(["zh-CN"]);
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });
    expect(screen.getByText("system zh-CN")).toBeTruthy();
  });

  it.each([
    ["zh-CN", "zh-CN zh-CN"],
    ["en", "en en"],
    ["fr", "system en"],
  ])("follows another tab that stores %j", (value, text) => {
    setLanguages(["en"]);
    render(<Probe />);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }));
    });
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("ignores another tab's change to other keys", () => {
    act(() => setLanguageChoice("zh-CN"));
    render(<Probe />);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "davloom-appearance" }));
    });
    expect(screen.getByText("zh-CN zh-CN")).toBeTruthy();
  });

  it("still applies a choice where storage refuses it, and reads System where it cannot read", () => {
    setLanguages(["en"]);
    const refusing = {
      getItem: () => {
        throw new DOMException("refused", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("refused", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("refused", "SecurityError");
      },
    };
    vi.stubGlobal("localStorage", refusing);
    render(<Probe />);
    act(() => setLanguageChoice("zh-CN"));
    expect(screen.getByText("zh-CN zh-CN")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(screen.getByText("system en")).toBeTruthy();
  });

  it.each([
    ["zh-CN", "zh-CN zh-CN"],
    ["fr", "system en"],
  ])("starts a visit with a stored %j as %s", async (stored, text) => {
    setLanguages(["en"]);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, stored);
    vi.resetModules();
    const fresh = await import("./store");
    const FreshProbe = () => (
      <p>
        {fresh.useLanguageChoice()} {fresh.useActiveLocale()}
      </p>
    );
    render(<FreshProbe />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

/**
 * Istanbul's counters live outside the function, so under `test:coverage` its source cannot run
 * alone, and the function itself runs instead.
 */
const isInstrumented = /\bcov_\w+/.test(applyLanguage.toString());

const ZH_PAGE = { title: "文件 | Davloom", description: "浏览文件" };

/** Runs the first-paint script as the browser runs it from <head>. */
const run = (chinese: typeof ZH_PAGE | null = ZH_PAGE) => {
  if (isInstrumented) {
    try {
      applyLanguage(LANGUAGE_STORAGE_KEY, chinese);
    } catch {
      // As the script's own try does.
    }
    return;
  }
  const script = document.createElement("script");
  script.textContent = languageScript(chinese);
  document.head.append(script);
  script.remove();
};

describe("the first-paint script", () => {
  beforeEach(() => {
    document.title = "Files | Davloom";
    const meta = document.createElement("meta");
    meta.name = "description";
    meta.content = "Browse files";
    document.head.append(meta);
  });

  afterEach(() => {
    document.head.querySelector('meta[name="description"]')?.remove();
  });

  it.each([
    [null, ["zh-CN"], "zh-CN"],
    [null, ["en-US", "zh"], "zh-CN"],
    [null, ["en-US"], "en"],
    [null, [], "en"],
    ["en", ["zh-CN"], "en"],
    ["zh-CN", ["en"], "zh-CN"],
    ["fr", ["en"], "en"],
  ] as const)("with %j stored and the browser's %j sets lang %s", (stored, languages, lang) => {
    if (stored !== null) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, stored);
    }
    setLanguages(languages);
    run();
    expect(document.documentElement.lang).toBe(lang);
    expect(document.title).toBe(lang === "zh-CN" ? ZH_PAGE.title : "Files | Davloom");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      lang === "zh-CN" ? ZH_PAGE.description : "Browse files",
    );
  });

  it("follows the browser where storage cannot be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("refused", "SecurityError");
      },
    });
    setLanguages(["zh-CN"]);
    run();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("leaves the title of a page without a Chinese one", () => {
    setLanguages(["zh-CN"]);
    run(null);
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe("Files | Davloom");
  });

  it("reads the browser's one language where it lists none", () => {
    setLanguages([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-HK");
    run();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(browserLanguages()).toEqual(["zh-HK"]);
  });

  it("writes the title on a page without a description", () => {
    document.head.querySelector('meta[name="description"]')?.remove();
    setLanguages(["zh-CN"]);
    run();
    expect(document.title).toBe(ZH_PAGE.title);
  });

  it.skipIf(isInstrumented)("refers to nothing outside its own source", () => {
    expect(languageScript(null)).toMatch(/^try\{\(function applyLanguage\(/);
  });
});

const Words = () => {
  const t = useT();
  return <p>{t("page.files.title")}</p>;
};

describe("the provider", () => {
  it("gives English outside any provider and the chosen language inside one", () => {
    render(
      <>
        <Words />
        <I18nProvider locale="zh-CN">
          <Words />
        </I18nProvider>
      </>,
    );
    expect(screen.getByText("Files | Davloom")).toBeTruthy();
    expect(screen.getByText("文件 | Davloom")).toBeTruthy();
  });

  it("draws the page once in each language for the prerender", () => {
    const { container } = render(
      <LocaleFrames>
        <Words />
      </LocaleFrames>,
    );
    const frames = [...container.querySelectorAll("[data-frame-locale]")];
    expect(
      frames.map((frame) => [frame.getAttribute("data-frame-locale"), frame.textContent]),
    ).toEqual([
      ["en", "Files | Davloom"],
      ["zh-CN", "文件 | Davloom"],
    ]);
  });
});

describe("RichText", () => {
  it("hands each tag's words to its renderer and keeps the rest as text", () => {
    const { container } = render(
      <p>
        <RichText
          text="Open <link>Credentials</link> or <b>this</b>."
          tags={{ link: (words) => <a href="/credentials">{words}</a> }}
        />
      </p>,
    );
    expect(container.textContent).toBe("Open Credentials or this.");
    expect(container.querySelector("a")?.textContent).toBe("Credentials");
  });
});

describe("LanguageSwitch", () => {
  it("names each language in its own words and switches between them", async () => {
    render(<LanguageSwitch />);
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "English",
      "简体中文",
      "System",
    ]);
    await userEvent.click(screen.getByRole("radio", { name: "简体中文" }));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});
