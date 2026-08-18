"""Does the official NBA stats API answer from this machine?

    python3 -m venv .venv-nba
    ./.venv-nba/bin/pip install nba_api
    ./.venv-nba/bin/python scripts/nba-api-probe.py

Run this before writing any ingestion against nba_api, and run it again on a
GitHub Actions runner. The daily scrape lives on Actions, so "it works on my
laptop" is not the question that matters.

The two checks are deliberately separated, because passing the first proves
nothing about the second:

  1. STATIC   — nba_api ships a bundled list of players and teams. This reads a
                local file. It succeeds with the network unplugged, so it only
                confirms the package is installed.

  2. LIVE     — an actual request to stats.nba.com. This is the real question.

stats.nba.com is undocumented and filters callers. When it declines, it does not
return 403 — it accepts the TCP connection, completes the TLS handshake, and then
never replies, so the failure looks like a hang rather than a refusal.
"""

import socket
import sys
import time

TIMEOUT = 30


def line(char="-"):
    print(char * 62)


def check_static():
    """Bundled data. No network. Proves only that the package imported."""
    print("\n[1/3] STATIC DATA (no network — local file lookup)")
    line()
    try:
        from nba_api.stats.static import players, teams

        found = players.find_players_by_full_name("Nikola Jokic")
        print(f"  players.find_players_by_full_name('Nikola Jokic') -> {found}")
        print(f"  teams.get_teams() returned {len(teams.get_teams())} teams")
        print("  PASS — package installed and importable")
        return True
    except Exception as exc:
        print(f"  FAIL — {type(exc).__name__}: {exc}")
        return False


def check_dns():
    """Separates 'cannot reach the host' from 'host will not answer me'."""
    print("\n[2/3] CONNECTIVITY (TCP reachability, no HTTP)")
    line()
    try:
        ip = socket.gethostbyname("stats.nba.com")
        print(f"  stats.nba.com resolves to {ip}")
        start = time.time()
        with socket.create_connection((ip, 443), timeout=10):
            print(f"  TCP 443 connected in {time.time() - start:.2f}s")
        print("  PASS — the host is reachable at the network level")
        return True
    except Exception as exc:
        print(f"  FAIL — {type(exc).__name__}: {exc}")
        return False


def check_live():
    """The real test: does stats.nba.com return data to this caller?"""
    print(f"\n[3/3] LIVE ENDPOINT (timeout {TIMEOUT}s)")
    line()
    print("  Calling PlayerCareerStats(player_id='203999')  # Nikola Jokic")
    print("  This is the example from the nba_api README.\n")

    try:
        from nba_api.stats.endpoints import playercareerstats

        start = time.time()
        career = playercareerstats.PlayerCareerStats(
            player_id="203999", timeout=TIMEOUT
        )
        data = career.get_dict()
        elapsed = time.time() - start

        sets = data.get("resultSets", [])
        rows = sets[0].get("rowSet", []) if sets else []
        print(f"  responded in {elapsed:.2f}s")
        print(f"  result sets: {len(sets)}")
        print(f"  rows in first set: {len(rows)}")
        if rows:
            headers = sets[0].get("headers", [])
            print(f"  first row: {dict(zip(headers, rows[0]))}")
        print("\n  PASS — the API answers this machine")
        return True

    except Exception as exc:
        elapsed = time.time() - start
        print(f"  FAIL after {elapsed:.2f}s — {type(exc).__name__}")
        print(f"  {exc}")
        print(
            "\n  A timeout here with check [2/3] passing means the host accepted\n"
            "  the connection and chose not to reply — filtering, not an outage."
        )
        return False


if __name__ == "__main__":
    print("nba_api reachability probe")
    line("=")

    static_ok = check_static()
    dns_ok = check_dns()
    live_ok = check_live()

    print()
    line("=")
    print(f"  package installed : {'yes' if static_ok else 'no'}")
    print(f"  host reachable    : {'yes' if dns_ok else 'no'}")
    print(f"  API answers       : {'yes' if live_ok else 'NO'}")
    line("=")

    if static_ok and dns_ok and not live_ok:
        print(
            "\nVERDICT: the package works and the host is reachable, but the API\n"
            "does not answer this caller. Run this same script on a GitHub\n"
            "Actions runner before building ingestion on it."
        )
    elif live_ok:
        print("\nVERDICT: usable from here. Still worth running on CI.")

    sys.exit(0 if live_ok else 1)
