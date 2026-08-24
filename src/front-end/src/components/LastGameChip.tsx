// The most recent game a player played, as of the date being viewed.
//
// A button, not a panel: it navigates to that game's view. Two sizes — the
// compact one for a leaderboard row, and a wide one for the hero card, which is
// a separate render path with no expandable drawer to hold it.
//
// ── "As of the date" is the whole feature ──────────────────────────────────
//
// Every relative phrase here is measured from the date on screen, never from
// now. On a January board, a game played in December reads "22 days earlier",
// because that is what it was at the time. Measuring from today would date the
// same game differently depending on when the page was opened, which is the
// class of error this project has already shipped once.

import { C, tabular } from "../theme";
import type { LastGame } from "../data/types";
import { teamLogoUrl } from "../data/team-logo";
import { daysBeforeLabel, scoreline, shortDate, venueLabel } from "../data/last-game";
import { HoverButton, TeamLogo } from "./ui";

type Props = {
  game: LastGame;
  /** The date the board is showing, which every relative phrase is measured from. */
  viewedDateKey: string;
  onOpen: () => void;
  wide?: boolean;
};

export default function LastGameChip({ game, viewedDateKey, onOpen, wide = false }: Props) {
  const logo = wide ? 26 : 22;
  const badge = wide ? 22 : 19;

  // The compact chip lives in a 224px column and measured 221px wide at an 8px
  // gap — three pixels of slack. Growing the logos had to be paid for, so the
  // gap tightens to 6: five gaps buy back 10px, the two discs spend 8, and the
  // mark still ends up two-thirds larger than it was.
  const gap = wide ? 10 : 6;

  return (
    <HoverButton
      onClick={onOpen}
      title={`${game.teamAbbr} ${scoreline(game)} ${venueLabel(game)} ${game.opponentAbbr} — ${shortDate(game.date)}`}
      style={{
        width: wide ? "100%" : undefined,
        display: "block", textAlign: "left",
        border: `1px solid ${wide ? C.accentDark : C.line}`,
        background: wide ? "rgba(145,132,217,0.07)" : "transparent",
        borderRadius: wide ? 10 : 9,
        padding: wide ? "11px 14px" : "7px 10px",
        cursor: "pointer",
      }}
      hoverStyle={{ borderColor: C.accentDeep, background: "rgba(145,132,217,0.10)" }}
    >
      <span style={{ display: "flex", alignItems: "center", gap }}>
        <span
          style={{
            width: badge, height: badge, borderRadius: 5, flex: "none",
            display: "grid", placeItems: "center",
            fontSize: wide ? 11 : 10, fontWeight: 600,
            background: game.win ? "rgba(145,132,217,0.18)" : C.raised,
            color: game.win ? C.accentPale : C.textFaint,
          }}
        >
          {game.win ? "W" : "L"}
        </span>

        <TeamLogo src={teamLogoUrl(game.teamId)} abbr={game.teamAbbr} size={logo} labelled={false} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: C.textMuted }}>
          {game.teamAbbr}
        </span>

        <span style={{ fontSize: wide ? 15 : 13, ...tabular, color: C.text, whiteSpace: "nowrap", flex: "none" }}>
          {scoreline(game)}
        </span>

        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: C.textFaint }}>
          {game.opponentAbbr}
        </span>
        <TeamLogo src={teamLogoUrl(game.opponentTeamId)} abbr={game.opponentAbbr} size={logo} dim labelled={false} />

        {wide && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.accentPale, whiteSpace: "nowrap" }}>
            {game.hasHighlight ? "▶ Watch highlights" : "View box score"}
          </span>
        )}
      </span>

      <span
        style={{
          display: "block", fontSize: 10, color: C.textGhost, marginTop: 5,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {`${venueLabel(game)} ${game.opponentAbbr} · ${shortDate(game.date)} · ${daysBeforeLabel(game.date, viewedDateKey)}`}
      </span>
    </HoverButton>
  );
}
