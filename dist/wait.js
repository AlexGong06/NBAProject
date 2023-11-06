"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wait = void 0;
async function wait(timeMs) {
    await new Promise((res) => {
        setTimeout(() => {
            res('');
        }, timeMs);
    });
}
exports.wait = wait;
