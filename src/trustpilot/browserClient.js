import { config } from "../config.js";
import { FetchMode, ScrapeErrorKind } from "./types.js";

export const fetchUrlBrowser = async (url, timeoutSeconds) => {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      ok: false,
      mode: FetchMode.BROWSER,
      statusCode: null,
      html: null,
      errorKind: ScrapeErrorKind.NETWORK,
      headers: new Map(),
      url,
    };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: config.userAgent });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(1, timeoutSeconds) * 1000,
    });
    await page.waitForTimeout(300);
    const html = await page.content();
    const finalUrl = page.url();
    await context.close();
    await browser.close();
    return {
      ok: true,
      mode: FetchMode.BROWSER,
      statusCode: response?.status() ?? null,
      html,
      errorKind: null,
      headers: new Map(),
      url: finalUrl || url,
    };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    const timedOut = error?.name === "TimeoutError";
    return {
      ok: false,
      mode: FetchMode.BROWSER,
      statusCode: null,
      html: null,
      errorKind: timedOut ? ScrapeErrorKind.TIMEOUT : ScrapeErrorKind.NETWORK,
      headers: new Map(),
      url,
    };
  }
};

