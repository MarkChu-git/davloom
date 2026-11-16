export const APPEARANCE_STORAGE_KEY = "davloom-appearance";

/** What `<meta name="color-scheme">` declares: the page supports both schemes. */
export const SUPPORTED_COLOR_SCHEMES = "light dark";

/**
 * Runs in <head> after the stylesheet, which React writes first, and before <body> is parsed. The
 * theme's colors follow `data-theme` on <html>, and the script also sets `color-scheme` there, so
 * the first paint shows the stored mode before any bundle has loaded. While the stylesheet loads,
 * the empty page may still follow the operating system's scheme (design.md Decision 7).
 */
export const APPEARANCE_SCRIPT = `try{var m=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});if(m==="light"||m==="dark"){var h=document.documentElement;h.setAttribute("data-theme",m);h.style.colorScheme=m}}catch(e){}`;
