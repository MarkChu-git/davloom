export const APPEARANCE_STORAGE_KEY = "davloom-appearance";

/**
 * Runs in <head> before the first paint. The theme's colors follow `data-theme` on <html>, so a
 * stored choice applies before any bundle has loaded and the page never flashes the wrong mode.
 */
export const APPEARANCE_SCRIPT = `try{var m=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;
