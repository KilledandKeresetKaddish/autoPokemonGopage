**作者常用指令 (cheat sheet) — 三种跑法**

固定环境变量(pi + 自建反代):`AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina`。
⚠️ **`PI_PROVIDER` 别漏** —— 漏了 pi 会回退到默认 `anthropic` provider,报 `No API key found for anthropic` 直接退出。

```bash
# ① 默认日更(无附加指令)—— 只做常规每日刷新
AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina \
  ./scripts/run-daily.sh

# ② 带一次性指令(operator note)—— 务必用单引号 '...' 包裹
#    指令作为第 1 个参数,仅本次有效,仍受 AGENTS.md 硬规则约束。
#    ⚠️ 指令里若含双引号(例如  例如:"本周 Max 团战" ),别用双引号包整段:
#    shell 会在第一个内部 " 处提前闭合 → 指令被截断,run-daily.sh 只收到前半截。
#    单引号内的双引号原样保留:
AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina \
  ./scripts/run-daily.sh '补上超级巨钳螳螂的 GOHub 团战指南链接,本月看点写详细点(可含 "引号")'

# ③ 复杂 / 多行 / 带各种引号 → 写进 note.txt,用 EXTRA_INSTRUCTIONS 传(最稳)
#    命令替换的结果不再被 shell 解析,note.txt 里随便用什么引号都安全。
AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina \
  EXTRA_INSTRUCTIONS="$(cat note.txt)" ./scripts/run-daily.sh

# ④ Spot Atlas 地点改动：明确的地点编辑指令本身就是本次授权，无需额外环境变量
AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina \
  ./scripts/run-daily.sh '在 Spot Atlas 中按以下资料新增地点……'
```

> **指令优先级**:位置参数 `$1` > `EXTRA_INSTRUCTIONS` 环境变量 > 无 → ② 和 ③ 二选一(同时给会忽略 env)。
> operator note 只对**本次**生效;越界要求(改 `style.css` / `app.js` / `index.html` marker 外的受保护文件)会被记到 `data/state.json` 并跳过,不强改、也不整次回滚。只有明确要求新增、删除或修正 Spot Atlas 地点的 note 才开放本次 `locations.json` 写权限;普通日更和无关 note 不开放。

**note.txt 方式的坑(逐条避雷)**

- **`PI_PROVIDER` 必带**:漏了 → `No API key found for anthropic`(回退默认 anthropic provider)。
- **provider/model 原样传递**:`run-daily.sh` 不改写 `PI_PROVIDER` 或 `PI_MODEL`;两者按当前 Pi/provider 配置填写(包括 provider 支持的含 `/` model id)。
- **note.txt 必须是 UTF-8(建议无 BOM)**:daily agent / pi 按**字节**读文件;Windows 记事本默认可能存成 GBK,那样 pi 收到的就是乱码(模型那边也乱)。确认:`file -i note.txt` 应是 `charset=utf-8`;Windows 用「另存为 → UTF-8」或 VS Code 右下角切到 `UTF-8`。
- **终端 `▒▒▒` 乱码 ≠ 内容坏了**:服务器 locale 不是 UTF-8 时,`run-daily.sh` 回显 operator note 会是一片 `▒`,但传给 pi 的字节是对的(`cat` / `printf` / shell 全按字节透传)。想终端也正常显示:跑前 `export LANG=C.UTF-8`(或 `en_US.UTF-8`)。**判断指令是否真进去别看终端花不花,看下面的 grep。**
- **note.txt 路径 = 当前目录相对路径**:在 `/opt/pogo-agent` 跑就 `cat note.txt`;路径错 / 文件空 → `cat` 得空串 → 等于没传指令(会按默认日更跑)。
- **确认完整指令真进了 prompt**:`grep -c '你指令里独有的关键词' note.txt`(查文件本身);开 `PI_VERBOSE=1` 后 `grep -c '关键词' logs/pi-events-$(date -u +%F).jsonl`(>0 即在 prompt 里、没被截断)。

**note.txt 完整命令(规避上面所有坑,可直接复制)**

```bash
cd /opt/pogo-agent                  # 确保在仓库根、note.txt 就在这
export LANG=C.UTF-8                 # 让终端也能正常显示中文(仅影响显示,可选)
file -i note.txt                    # 一次性自检:应输出 charset=utf-8(不是 gbk/iso-8859)
AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina \
  EXTRA_INSTRUCTIONS="$(cat note.txt)" ./scripts/run-daily.sh
```

> 想边跑边看工具调用,在最后那条命令最前面再加 `PI_VERBOSE=1`,然后另开终端 `tail -F`(见下)。

**实时观看 pi 的工具调用(可选)**

加 `PI_VERBOSE=1`:pi 切到 `--mode json`,事件流写进 `logs/pi-events-<UTC日期>.jsonl`(主终端只剩 `preflight / validate / publish` 几行 —— **这是正常的**,洪流进了文件、没崩)。另开一个终端:
```bash
tail -F logs/pi-events-$(date -u +%F).jsonl | jq -c 'select(.type|test("tool_execution"))'
```
> `--mode json` 下最终的人类可读总结藏在 `message_*` 事件里(不是纯文本),所以仅调试时开 `PI_VERBOSE=1`;平时默认 `-p` 保留可读总结。


推送用指令:
```
# 1) 先看这次跑产出了什么、本地比 GitHub 领先哪些提交
git fetch origin main
git log --oneline origin/main..main     # 应看到一条 chore(daily): content update 2026-06-…
git status                               # 工作区应是 clean(raw/logs 是 gitignore,正常)

# 2) 推送
git push origin main
```


# pogo-agent

A self-contained bilingual **Pokémon GO dashboard** (简体中文 / English, one-click
persistent switch) that a coding-agent CLI updates **once a
day**. The agent is the "brain" (reads data, curates content, edits the page); the
repo ships the static site, the data-fetch toolbox, and a validate/resume/rollback safety net.

The dashboard includes:
1. **当月日历** — month calendar, driven by `public/data/events.json` (events from
   [LeekDuck](https://leekduck.com/) via [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck)).
2. **战力榜** — Max attackers / defenders, current raid counters, and current priorities.
3. **超级进化** — roster, mechanics tables, and upgrade planner.
4. **世界时钟** — live IANA-zone time-window comparison.
5. **Spot Atlas / 地点图鉴** — an initial 23 location cards from `public/data/locations.json`, with
   filters, official-map links, coordinate copying, and each location's next local Tuesday
   20:00 converted to the browser's dynamically detected IANA timezone.
6. **多账号 TODO** and **实用链接** — owner-maintained tools.

The daily agent owns event/ranking content. Spot Atlas data changes only when an operator note
explicitly requests a location edit; names and notes remain one canonical, untranslated value.

## How it works

```
cron ──> scripts/run-daily.sh
            ├─ restores a matching pending draft, if one exists
            ├─ invokes one Pi with AGENTS.md + daily-update + six briefs, each once
            │     Pi: Source → Calendar → Rotations → Rankings → English → State/gates
            │         (all sequential; no delegation or child agent)
            ├─ scripts/validate.sh   (protected files intact? markers balanced? JSON valid?)
            └─ pass ─> publish.sh + clear draft
                fail ─> atomically save allowed changes, then git rollback
```

- **One Pi, one context.** With `AGENT_CLI=pi`, `run-daily.sh` makes one Pi call and
  executes all six briefs in order. It disables ambient extensions, skills, prompt
  templates, context files and sessions, exposes only `read,bash,edit,write`, and
  embeds each governing document once. The existing alternate CLI cases remain for
  compatibility, but daily briefs forbid delegation or launching another agent.
- **The agent only edits** the explicit paths in `AGENTS.md`, the text-only English
  overlay, and the five marked Chinese regions. `locations.json` is allowed only for an
  explicit operator-requested Spot Atlas change; it is untouched on routine refreshes.
  Dates/IDs/links/sprites remain single-source; validation enforces bilingual overlay parity
  plus the Spot Atlas schema/timezone fixtures. `app.js`, `style.css`, static UI strings and
  the rest of `index.html` are checksum/structure protected, so invalid daily work rolls back.

## Layout
```
public/        static site served by Caddy (index.html, app.js, style.css, data/)
data/raw/      raw fetched data (gitignored; regenerated by fetch.sh)
data/state.json agent bookkeeping
scripts/       fetch.sh · run-daily.sh · resume-snapshot.sh · validate.sh · test-spot-atlas-time.js · publish.sh · protected.sha256
AGENTS.md      daily-agent contract   (CLAUDE.md is the maintainer guide)
tasks/daily-update.md  the single-Pi daily sequence
tasks/subagents/      six sequential responsibility briefs (same Pi, no delegation)
```

## Data sources
| source | type | fetch |
|---|---|---|
| events / raids / eggs / research | ScrapedDuck JSON (clean direct fetch) | ✅ curl |
| gamemaster | PvPoke stats/moves/types (clean direct fetch) | ✅ curl |
| sprites | PokeAPI CDN, used directly in `<img>` | ✅ no fetch |
| tiers-attackers / tiers-defenders | pokemongohub.net | ⚠️ Cloudflare challenge |

**Cloudflare note:** the two Hub tier-list pages are behind a Cloudflare *managed
challenge* — a plain curl only returns the "Just a moment…" page. `fetch.sh` routes
them through a solver, chosen with `TIER_METHOD`:
- `jina` (default) — [Jina Reader](https://jina.ai/reader/) `https://r.jina.ai/<url>`,
  zero install, returns rendered content. Verify it works for you:
  `curl -s https://r.jina.ai/https://pokemongohub.net/post/guide/max-attackers-tier-list/ | head`
- `flaresolverr` — self-hosted [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
  (`docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr`); set
  `FLARESOLVERR_URL` if not on localhost.
- `direct` — plain curl (only if the page isn't protected).

## VPS deploy (≈10 min)

```bash
# 1. prerequisites — Caddy already serves :80/:443; just add the agent's tools
sudo apt update && sudo apt install -y git curl jq util-linux

# 2. install ONE coding-agent CLI + API key, set AGENT_CLI. You're using Codex
#    against an OpenAI-compatible proxy — see the Codex section below for config.

# 3. clone the branch
sudo git clone -b claude/amazing-mccarthy-m65i8i <this-repo-url> /opt/pogo-agent
cd /opt/pogo-agent

# 4. serve public/ with Caddy: add a site block to /etc/caddy/Caddyfile
#    (snippet shown below), then reload
sudo systemctl reload caddy

# 5. dry-run once, then check it validated
export AGENT_CLI=codex TIER_METHOD=jina OPENAI_API_KEY=sk-...
./scripts/run-daily.sh
cat logs/daily-*.log

# 6. schedule it (08:00 daily)
( crontab -l 2>/dev/null; \
  echo "0 8 * * * cd /opt/pogo-agent && AGENT_CLI=codex TIER_METHOD=jina OPENAI_API_KEY=sk-... ./scripts/run-daily.sh" \
) | crontab -
```

### Caddy site block

Caddy already runs on :80/:443. Add a site block to `/etc/caddy/Caddyfile`, then
`sudo systemctl reload caddy`:

```caddy
pogo.example.com {
    root * /opt/pogo-agent/public
    encode gzip
    file_server
}
```
No domain yet? Replace the first line with `:80 {` to serve over plain HTTP on the IP.

### Using Codex against an OpenAI-compatible reverse proxy

`AGENT_CLI=codex` is supported. **Caveat:** current Codex (since Feb 2026) speaks
only the OpenAI **Responses** API — your proxy must expose `/v1/responses`, not just
`/v1/chat/completions`. Copy `examples/codex-config.toml` to `~/.codex/config.toml`
and fill in `base_url`, `env_key`, `model`. It also sets
`[sandbox_workspace_write] network_access = true` so `fetch.sh` can reach the network.

```bash
cp /opt/pogo-agent/examples/codex-config.toml ~/.codex/config.toml   # then edit it
# cron line:
( crontab -l 2>/dev/null; \
  echo "0 8 * * * cd /opt/pogo-agent && AGENT_CLI=codex TIER_METHOD=jina OPENAI_API_KEY=sk-... ./scripts/run-daily.sh" \
) | crontab -
```

`run-daily.sh` invokes `codex exec --sandbox workspace-write -a never` (no prompts,
edits + network allowed). If the sandbox gets in the way, switch it to
`codex exec --dangerously-bypass-approvals-and-sandbox`.

### Using Pi (Pi Coding Agent)

`AGENT_CLI=pi` is the daily setup. `run-daily.sh` invokes one non-interactive Pi
with `--no-extensions --no-skills --no-prompt-templates --no-context-files
--no-session --tools read,bash,edit,write`. It embeds `AGENTS.md`, the daily task and
all six briefs once, then that same Pi completes them sequentially. There is no Pi
session or delegated child to resume; `fetch.sh`/`discover.sh` remain its network path.

Register your proxy in `~/.pi/agent/models.json` (copy `examples/pi-models.json`).
It uses `api: "openai-responses"`, reusing the `/v1/responses` endpoint you already
confirmed; `apiKey` interpolates `$OPENAI_API_KEY`. It also sets a `headers` override:
some proxies/WAFs return `403 "Your request was blocked"` on the OpenAI SDK's
`User-Agent: OpenAI/JS` — overriding User-Agent to a plain value fixes it.

```bash
mkdir -p ~/.pi/agent && cp examples/pi-models.json ~/.pi/agent/models.json   # edit baseUrl/id
# cron line (set PI_PROVIDER to the provider id, PI_MODEL to a name pattern):
( crontab -l 2>/dev/null; \
  echo "0 8 */3 * * cd /opt/pogo-agent && AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=claude-opus-4-8 TIER_METHOD=jina OPENAI_API_KEY=sk-... ./scripts/run-daily.sh" \
) | crontab -
```

#### Failed-run draft recovery

On an agent, gate, or pre-commit publish failure, `run-daily.sh` atomically writes one
pending snapshot under the gitignored `logs/resume/`, then rolls allowed content back
to the last commit. The snapshot captures final working-tree content relative to that
base, including deletions, staging and allowed untracked paths. The next clean run
restores it only when base HEAD, operator-note hash, checksum, paths and patch all
match; otherwise it logs the reason, discards eligibility and starts fresh.

A restored snapshot is only a possibly incomplete draft. The same Pi first inspects
it, then still performs Source Scout, freshness/discovery checks and date maintenance.
The committed base `data/state.json` is the last successful source baseline; draft
hashes must not manufacture a quiet day. Updated sources supersede stale draft facts,
while still-valid edits may be reused. A successful publish, including a valid no-op,
clears the snapshot. If snapshot saving itself fails, the dirty tree is left intact
instead of being rolled back.

The legacy warning check for an unacknowledged background writer remains fail-closed.
If such output somehow appears, termination is unproven, so the wrapper deliberately
does not snapshot or roll back. `flock` (from `util-linux`) still rejects concurrent
runs.

Rollback a published bad day: `git -C /opt/pogo-agent revert <commit>` (or `checkout <good-sha> -- public`).

---

## Setup notes — this deployment (personal, single VPS)

> 本仓库是 public,但本质是个人单机自用、只面向自己的 VPS。下面记录最终可用配置与踩过的坑,
> 方便日后自己或其它 LLM 接手,不必重新趟一遍。The proxy host and API key are intentionally omitted.

**Stack & flow.** `cron (every 3 days)` → `scripts/run-daily.sh` → **pi** (Pi Coding Agent,
`AGENT_CLI=pi`) receives `AGENTS.md` + `tasks/daily-update.md` + all six briefs once,
runs `scripts/fetch.sh` (events/raids/gamemaster from raw GitHub; Hub tier pages via Jina Reader), rewrites
`public/data/events.json` + the `AI:` regions of `public/index.html`, then `scripts/validate.sh`
gates and `publish.sh` does a local `git commit` (no push by default). **Caddy** serves
`/opt/pogo-agent/public`. pi talks to a self-hosted **OpenAI-compatible reverse proxy
(Responses API)** backed by Claude.

**Agent config (host/key redacted).** Clone to `/opt/pogo-agent`; `~/.pi/agent/models.json`
registers the proxy as a provider — see `examples/pi-models.json`: `api:"openai-responses"`,
`baseUrl` ends in `/v1`, `apiKey` via `$OPENAI_API_KEY` or a literal, a `headers` User-Agent
override, and a `cost` block with `cacheRead`/`cacheWrite`. cron (set `PATH` so `pi`/`node` resolve):

```
0 8 */3 * * cd /opt/pogo-agent && AGENT_CLI=pi PI_PROVIDER=myproxy PI_MODEL=<model-id> TIER_METHOD=jina OPENAI_API_KEY=... /opt/pogo-agent/scripts/run-daily.sh
```

**Gotchas (already solved — don't re-debug):**
1. **ScrapedDuck** JSON lives on the `data` branch:
   `raw.githubusercontent.com/bigfoott/ScrapedDuck/data/<events|raids|eggs|research>.json`.
   **PvPoke** gamemaster: `.../pvpoke/pvpoke/master/src/data/gamemaster.min.json`. Sprites:
   PokeAPI by dex id. All clean to `curl`.
2. **pokemongohub.net is behind a Cloudflare *managed challenge*** — plain `curl` *and* a headless
   browser get 403. The two tier pages are fetched via **Jina Reader** (`TIER_METHOD=jina` →
   `https://r.jina.ai/<url>`), which returns clean markdown. **No headless browser is needed.**
3. **pi `models.json`:** each model's `cost` MUST include `cacheRead` and `cacheWrite`, or pi
   rejects the whole file and reports `Unknown provider`.
4. **The proxy/WAF 403s the OpenAI SDK `User-Agent: OpenAI/JS`** ("Your request was blocked").
   Body/tools/streaming are all fine — it is purely the UA header. Fix = the `headers` override in
   `models.json` (set `User-Agent` to a plain value).
5. **Provider/model selection is pass-through.** `run-daily.sh` supplies
   `--provider "$PI_PROVIDER" --model "$PI_MODEL"` without parsing or rewriting either value;
   authentication and model-id interpretation stay in the existing Pi/provider configuration.
6. **cron PATH is minimal** — set `PATH` so `pi` and `node` resolve (`which pi node`), else
   "command not found".
7. **Codex** was evaluated as an alternative agent: it needs the OpenAI *Responses* API
   (`wire_api="responses"`; chat removed Feb 2026). Works against the same proxy; we chose pi
   (native `AGENTS.md`, simpler, no sandbox). See `examples/codex-config.toml`.

**⚠️ Editing the frontend (`app.js` / `style.css` / `index.html`).** The validate gate checks the
`sha256` of the frontend, static UI dictionary, scripts/instructions and `.gitignore` against
`scripts/protected.sha256`, and requires
the `AI:START/END` markers + key `id`s + `.rank-panel` wrappers in `index.html`. **After any change
to any protected script/instruction/frontend file, regenerate the checksums**, or the next daily run fails validation and
rolls back:

```
sha256sum .gitignore public/app.js public/style.css public/data/i18n/ui.json scripts/*.sh scripts/*.js AGENTS.md CLAUDE.md tasks/daily-update.md tasks/spot-atlas.md tasks/subagents/*.md > scripts/protected.sha256
```

The daily agent edits only the paths in `AGENTS.md`: canonical content JSON, the nested
text-only English overlay, state/meta, and the five required AI regions. Spot Atlas
`locations.json` is operator-note-only. Everything else is maintainer-owned (then re-checksum).

Run the complete local gates without publishing:

```bash
bash scripts/test-run-daily.sh       # temporary repos + mock Pi; no model/publish target
node scripts/test-spot-atlas-time.js
scripts/preflight.sh
scripts/validate.sh
```

The timezone test imports the production helpers from `public/app.js` and supplies fixed display
zones, so results are deterministic regardless of the machine running the test.
