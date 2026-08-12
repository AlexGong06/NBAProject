"use strict";
// Generates the front end's offline fixture from real stored rankings.
//
//   pnpm generate-fixture
//
// Reads a window of real rows out of MongoDB, recovers each player's games
// played on each date from their Basketball Reference game log, recomputes the
// score under the current formula, and writes the result to
// src/front-end/public/rankings.json.
//
// The front end fetches that file in fixture mode. It is committed, so a fresh
// clone runs with no database and no network — and what it shows is real data
// rather than a simulation, including the days the collector genuinely missed.
//
// This script is a development tool. It is never run by the app or by CI.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongodb_1 = require("mongodb");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
const path_1 = require("path");
const logger_1 = __importDefault(require("../src/utils/logger"));
const mvp_formula_1 = require("../src/shared/mvp-formula");
const types_1 = require("../src/utils/types");
const date_key_1 = require("../src/utils/date-key");
const scrape_player_game_log_1 = require("../src/services/scraper/scrape-player-game-log");
dotenv_1.default.config();
/** How many calendar days back from the most recent scrape to include. */
const WINDOW_DAYS = 30;
const OUT = (0, path_1.join)(__dirname, "..", "src", "front-end", "public", "rankings.json");
function isoOf(dateKey) {
    const d = (0, date_key_1.parseDateKey)(dateKey);
    if (!d)
        throw new Error(`Unparseable date key: ${dateKey}`);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function main() {
    var _a, _b;
    const uri = process.env.MONGO_URI;
    if (!uri)
        throw new Error("Missing MONGO_URI");
    const season = (_a = process.env.NBA_SEASON) !== null && _a !== void 0 ? _a : "2026";
    const client = new mongodb_1.MongoClient(uri);
    await client.connect();
    const col = client.db("NbaDb").collection("DailyMvpRankings");
    // ── Pick the window ──────────────────────────────────────────────────────
    const allKeys = await col.distinct("date");
    const sorted = [...allKeys].sort(date_key_1.compareDateKeys);
    const lastKey = sorted[sorted.length - 1];
    const last = (0, date_key_1.parseDateKey)(lastKey);
    if (!last)
        throw new Error(`Unparseable latest date: ${lastKey}`);
    const firstDate = new Date(last);
    firstDate.setDate(firstDate.getDate() - (WINDOW_DAYS - 1));
    // Every calendar day in the window, so days with no scrape stay visible as
    // gaps rather than disappearing from the timeline.
    const calendar = [];
    for (let d = new Date(firstDate); d <= last; d.setDate(d.getDate() + 1)) {
        calendar.push((0, date_key_1.toDateKey)(d));
    }
    const windowKeys = calendar.filter((k) => allKeys.includes(k));
    logger_1.default.info(`window ${calendar[0]} -> ${lastKey}: ${windowKeys.length} scraped of ${calendar.length} days`);
    const rows = await col.find({ date: { $in: windowKeys } }).toArray();
    logger_1.default.info(`loaded ${rows.length} rows`);
    // ── Recover games played from game logs ──────────────────────────────────
    const byPlayer = new Map();
    for (const r of rows) {
        if (!byPlayer.has(r.player))
            byPlayer.set(r.player, { profileUrl: r.profileUrl });
    }
    logger_1.default.info(`fetching game logs for ${byPlayer.size} players`);
    const logs = new Map();
    for (const [playerName, { profileUrl }] of byPlayer) {
        try {
            const entries = await (0, scrape_player_game_log_1.fetchPlayerGameLog)({ profileUrl, playerName, season });
            await new Promise((r) => setTimeout(r, scrape_player_game_log_1.POLITE_DELAY_MS));
            logs.set(playerName, entries);
            logger_1.default.info(`  ${playerName}: ${entries.length} logged games`);
        }
        catch (err) {
            logger_1.default.error(`  ${playerName}: game log failed — ${String(err)}`);
            logs.set(playerName, []);
        }
    }
    // ── Recompute under the current formula ──────────────────────────────────
    const missingGameLog = [];
    const out = rows.map((r) => {
        var _a, _b, _c, _d;
        const entries = (_a = logs.get(r.player)) !== null && _a !== void 0 ? _a : [];
        const gamesPlayed = (0, scrape_player_game_log_1.gamesPlayedAsOf)(entries, isoOf(r.date));
        // A player with no usable log would otherwise score zero and silently sink
        // to the bottom of the board. Record it and fail loudly below instead.
        if (entries.length === 0)
            missingGameLog.push(r.player);
        // Built field by field rather than spread from the Mongo document: the
        // driver types rows as opaque Documents, so a spread would hide a missing
        // field behind a cast and score it as zero.
        const base = {
            date: r.date,
            player: r.player,
            profileUrl: r.profileUrl,
            team: r.team,
            pos: ((_b = r.pos) !== null && _b !== void 0 ? _b : null),
            age: ((_c = r.age) !== null && _c !== void 0 ? _c : null),
            teamWins: r.teamWins,
            teamLosses: ((_d = r.teamLosses) !== null && _d !== void 0 ? _d : r.teamGamesPlayed - r.teamWins),
            teamGamesPlayed: r.teamGamesPlayed,
            gamesStarted: r.gamesStarted,
            gamesPlayed,
            minutesPerGame: r.minutesPerGame,
            pointsPerGame: r.pointsPerGame,
            assistsPerGame: r.assistsPerGame,
            reboundsPerGame: r.reboundsPerGame,
            blocksPerGame: r.blocksPerGame,
            stealsPerGame: r.stealsPerGame,
            foulsPerGame: r.foulsPerGame,
            turnoversPerGame: r.turnoversPerGame,
            usageRate: r.usageRate,
            valueOverReplacement: r.valueOverReplacement,
            winShare: r.winShare,
            boxPlusMinus: r.boxPlusMinus,
            trueShootingPercentage: r.trueShootingPercentage,
        };
        return {
            ...base,
            ...(0, mvp_formula_1.scoreBreakdown)(base),
            formulaVersion: types_1.CURRENT_FORMULA_VERSION,
        };
    });
    if (missingGameLog.length > 0) {
        throw new Error(`No game log for ${[...new Set(missingGameLog)].join(", ")} — every player ` +
            `needs one, or their availability would silently be zero.`);
    }
    // ── Rank within each date ────────────────────────────────────────────────
    const grouped = new Map();
    for (const row of out) {
        const list = (_b = grouped.get(row.date)) !== null && _b !== void 0 ? _b : [];
        list.push(row);
        grouped.set(row.date, list);
    }
    const ranked = [...grouped.values()].flatMap((list) => list
        .sort((a, b) => b.mvpValue - a.mvpValue)
        .map((row, i) => ({ ...row, calculatedRank: i + 1 })));
    ranked.sort((a, b) => (0, date_key_1.compareDateKeys)(b.date, a.date) || a.calculatedRank - b.calculatedRank);
    (0, fs_1.mkdirSync)((0, path_1.join)(__dirname, "..", "src", "front-end", "public"), { recursive: true });
    (0, fs_1.writeFileSync)(OUT, JSON.stringify(ranked));
    logger_1.default.info(`wrote ${ranked.length} rows to ${OUT}`);
    logger_1.default.info(`days: ${windowKeys.length} scraped, ${calendar.length - windowKeys.length} gaps`);
    await client.close();
}
main().catch((err) => {
    logger_1.default.error(err);
    process.exit(1);
});
