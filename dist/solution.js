"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const playwright_1 = require("playwright");
const wait_1 = require("./wait");
//import * as fs from 'fs';
async function main() {
    /**
     * Flow of program:
     */
    const browser = playwright_1.chromium.launch({ headless: false });
    const page = await new Promise((resolve) => {
        browser.then(async (browser) => {
            resolve(await browser.newPage());
        });
    });
    await page.goto("https://www.basketball-reference.com/");
    await (0, wait_1.wait)(2000);
    await page.click("[id='header_leaders']");
    await (0, wait_1.wait)(5000);
}
exports.main = main;
