// Ranking and persistence concerns around the MVP score.
//
// The formula itself is NOT here — it lives in src/shared/mvp-formula.ts, which
// this file and the front end both import. Do not reimplement it here; that
// duplication is what let a formula change ship with the front end silently
// ignoring it.
//
// This module owns what the browser must not carry: pino logging, Zod
// validation of the output, sort order, rank assignment, and the formula
// version stamp.

import logger from "../../utils/logger";
import { scoreBreakdown, scoreOf } from "../../shared/mvp-formula";
import {
  CURRENT_FORMULA_VERSION,
  PlayerWithCalculatedMvpValueSchema,
} from "../../utils/types";
// Type-only, so this file can be pulled into the front end's program (which
// runs with verbatimModuleSyntax) without dragging Zod in as a value import.
import type {
  FullPlayerSummary,
  PlayerWithCalculatedMvpValue,
} from "../../utils/types";

// Exported for tests: the scoring rule is the product this repo exists to
// produce, and it should be assertable without going through ranking.
//
// The arithmetic lives in src/shared/mvp-formula.ts, which the front end also
// imports. This wrapper adds the logging that a browser bundle must not carry.
export function calculatePlayerValue(player: FullPlayerSummary): number {
  logger.info(`calculating mvp value for ${player.player}`);
  const totalValue = scoreOf(player);
  logger.info(`mvp value: ${totalValue}`);
  return totalValue;
}

export function calculateAllPlayerValues(
  players: FullPlayerSummary[],
): PlayerWithCalculatedMvpValue[] {
  // Keep the whole breakdown, not just the final number.
  //
  // scoreBreakdown() computes every intermediate term on its way to mvpValue.
  // Storing all of them is what lets the front end display a player's
  // win-contribution split without re-running the formula — which is how the
  // app ended up with two implementations of one calculation.
  const sortedPlayers = players
    .map((player) => {
      logger.info(`calculating mvp value for ${player.player}`);
      const breakdown = scoreBreakdown(player);
      logger.info(`mvp value: ${breakdown.mvpValue}`);
      return {
        ...player,
        ...breakdown,
      };
    })
    .sort((a, b) => b.mvpValue - a.mvpValue); // highest value first

  const finalArray: PlayerWithCalculatedMvpValue[] = [];

  // 3. Assign calculatedRank
  sortedPlayers.forEach((player, index) => {
    const ranked = {
      ...player,
      calculatedRank: index + 1,
      formulaVersion: CURRENT_FORMULA_VERSION,
    };

    const validated = PlayerWithCalculatedMvpValueSchema.safeParse(ranked);

    if (!validated.success) {
      logger.error(`Output validation failed for player ${player.player}:`);
      logger.error(validated.error.format());
      throw new Error(
        `Invalid PlayerWithCalculatedMvpValue for ${player.player}`,
      );
    }

    finalArray.push(validated.data);
  });

  return finalArray;
}
