import { Browser, chromium, Page } from "playwright";
import { wait } from "./wait";
//import * as fs from 'fs';

export async function main() {
  /**
   * Flow of program:
   */
  const browser = chromium.launch({ headless: false });
  const page = await new Promise<Page>((resolve) => {
    browser.then(async (browser) => {
      resolve(await browser.newPage());
    })
  })
  await page.goto("https://www.basketball-reference.com/");
  await wait(2000)
  await page.click("[id='header_leaders']");
  await wait(5000);
}
