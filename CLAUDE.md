# Sofi Auto-Claim Bot — Project Guide

## What This Project Does

A Discord self-bot that autonomously runs a Sofi card drop cycle:
1. Sends `sdrop` or `sd` every ~8 minutes (+/-2 min jitter) to trigger card drops
2. Parses Sofi's response to extract gen + wishlist from message content and buttons
3. Claims the best card based on priority rules (always claims, never skips)
4. During events: claims event items (free) + regular card (two clicks per drop)
5. Runs extra commands (`scd` 10-12x/day, `sdaily` every ~24h) for human activity
6. Simulates human behavior (Gaussian delays, AFK breaks, sleep window)

**Only claims from its own drops** — never claims from other users' drops.

---

## Project Structure

```
Sofi-Bot/
├── src/
│   ├── bot.js            Main entry point — Discord client, main loop, dual claim
│   ├── parser.js         Parse Sofi's drop messages (gen from content, WL from buttons)
│   ├── claimDecision.js  Priority engine (P0-P4: gen, event, WL, random)
│   ├── humanSim.js       Human simulation: Gaussian delays, AFK breaks, IST time
│   ├── scheduler.js      Sleep window (2am-5am IST) + AFK break management
│   └── logger.js         Winston logger (console + file)
├── config/
│   └── index.js          All thresholds, event settings, timings (edit here)
├── logs/                 Auto-created by winston
├── .env                  Your tokens (never commit this)
├── .env.example          Template for .env
├── ecosystem.config.js   PM2 process config
└── package.json
```

---

## Setup

```bash
npm install
cp .env.example .env
# Fill in TOKEN in .env

# Add your channel IDs to config/index.js → CHANNELS array
# (Right-click channel in Discord → Copy Channel ID, requires Developer Mode)
```

**Getting your Discord token:**
- Open Discord in browser → DevTools (F12) → Network tab
- Reload the page, find any request to discord.com/api
- Look in request headers for `Authorization` — that's your token

---

## Running

```bash
# Development (with logs to console)
npm run dev

# Production via PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 logs sofi-bot     # View live logs
pm2 status            # Check running status
```

### Dry Run Mode (test without clicking)
```bash
DRY_RUN=true node src/bot.js
```
The bot will log every decision but never actually click any buttons.

---

## Claim Priority Logic

| Priority | Condition | Action |
|----------|-----------|--------|
| P0 | Gen <= 10 | ALWAYS pick (absolute rarest) |
| P1 | Event card (no gen) | Always pick, UNLESS event WL < 100 AND normal card WL > 1000 |
| P2 | Gen <= 100 AND WL > 500 | Pick, BUT if another card has WL >= 2500, pick high WL instead |
| P3 | Default | Pick highest wishlist card |
| P4 | All WL = 0 | Pick random card |

**Never skips** — always claims a card from every drop.

### Event Handling
- **Event items** (onigiri, shells, roses): free claim buttons (no grab cooldown). Bot clicks these FIRST, then claims a regular card.
- **Event cards**: identified by empty gen field. Prioritized unless low WL + high normal WL available.

---

## Key Thresholds (edit in `config/index.js`)

| Key | Default | Meaning |
|-----|---------|---------|
| `GEN_SUPER_ULTRA` | 10 | Gen <= 10 = absolute top priority |
| `GEN_ULTRA_LOW` | 100 | Gen <= 100 = very rare |
| `GEN_ULTRA_WL_MIN` | 500 | Gen <= 100 card must have WL > this |
| `WL_OVERRIDE_THRESHOLD` | 2500 | WL >= 2500 beats gen <= 100 priority |
| `EVENT_CARD_WL_MIN` | 100 | Min WL for event card auto-pick |
| `EVENT_NORMAL_WL_OVERRIDE` | 1000 | Normal WL must exceed this to beat low-WL event |
| `EVENT_ITEM_NAMES` | onigiri, shells, roses... | Change per event season |
| `SLEEP_START_HOUR_IST` | 2 | Sleep starts at 2am IST |
| `SLEEP_END_HOUR_IST` | 5 | Sleep ends at 5am IST |
| `DROP_JITTER_MS` | 120000 | +/-2 min jitter on drop timing |
| `SCD_DAILY_COUNT_MIN/MAX` | 10/12 | scd commands per day |
| `SDAILY_INTERVAL_MS` | 86400000 | sdaily every ~24 hours |

---

## Parser Format

Sofi's drop message format:
- **Gen** comes from message content: `` G•`1486` `` (or empty `` G•`    ` `` for event cards)
- **Wishlist** comes from button labels: plain numbers like "0", "82"
- **Event items** use non-dropheart emoji (onigiri, shells, roses)

If parsing breaks, set `LOG_LEVEL=debug` and check card line parsing output.

---

## Anti-Detection Summary

- Reaction delays: 4-18s normal, 8-30s late night (Gaussian distribution)
- No random skip — always claims (more natural than skipping)
- Sleep: 2am-5am IST only (with +/-20min jitter)
- 2-4 AFK breaks/day (20-60 min each) + lunch break
- Drop timing: 8 min +/- 2 min jitter
- Alternates between `sdrop` and `sd` commands
- `scd` command 10-12x/day at random times
- `sdaily` command every ~24 hours (+/-2h jitter)
- Typing simulation with per-character delays

---

## VM Deployment (Ubuntu)

```bash
# Install Node 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Copy project, install deps
npm install

# Setup PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # Follow the printed command to enable auto-start on reboot
```

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes � gives risk-scored analysis |
| `get_review_context` | Need source snippets for review � token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
