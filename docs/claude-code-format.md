# Claude Code files the tracker reads

The formats below are undocumented. They were checked on this PC on 2026-10-23 with Claude Code CLI 2.1.302 (`entrypoint: "cli"`) and Claude Desktop transcripts from 2.1.299 (`entrypoint: "claude-desktop"`). The tracker only reads them. It never writes anything under `~/.claude`.

## Never touch

- `sessions/<pid>.<hash>.key`: secret token.
- `.credentials.json`.
- The session pipes and sockets (`messagingSocketPath`).
- `sessions/.fleetview-heartbeat`: creating it makes every session spend tokens on state summaries.

## Running sessions: `~/.claude/sessions/<pid>.json`

There is one file per running process. Claude Code deletes it when the process exits cleanly. A crash leaves it behind.

**Fields:**
- `pid`, `sessionId`, `cwd`, `startedAt` (ms)
- `procStart`: Windows FILETIME, as a string
- `version`, `kind` (`interactive`, `bg` or `daemon`), `entrypoint`
- `name` and `nameSource` (`derived` means a generated name)
- `status`: `busy`, `idle` or `waiting`
- `waitingFor`: only when waiting, e.g. `permission prompt`, `input needed`, `dialog open`, `sandbox request`
- `statusUpdatedAt`, `updatedAt`
- `pidDomain`, e.g. `win32:<host>`
- Also `peerProtocol`, `peerFeatures` and `messagingSocketPath`, which the tracker ignores.

**Status meanings:**
- `busy`: the main thread is working, or background agents are still running.
- `waiting`: a dialog is open.
- `idle`: neither.

**How the tracker uses it:**
- It ignores half-written JSON and keeps the previous value.
- It checks the PID with `process.kill(pid, 0)`.
- Every 60 s it runs one `tasklist` call to reject PIDs that another program has reused. An entry whose PID was seen dead once stays dead.
- If the file is gone but the PID is still alive, the session leaves after 1.5 s.
- No Claude Desktop entry was present while testing, because no Desktop session was running.

## Transcripts: `~/.claude/projects/<slug>/<sessionId>.jsonl`

- **One record per line, append-only.** Each assistant content block gets its own record. File order is reliable; timestamps are not in order.
- **The same session ID can sit in two project folders** after a cwd change. Pick the most recently modified file and never rebuild the slug.

**Records used:**

| record | meaning |
|---|---|
| `assistant` + `message.content[].tool_use{id,name,input}` | tool call opened. The main thread writes its records when the response ends (`stop_reason` `tool_use` or `end_turn`). Subagents write each block as it completes (`stop_reason: null`). |
| `user` + `tool_result{tool_use_id}` | tool call closed. `toolUseResult.status === "async_launched"` (with `agentId`) means a background subagent was launched. |
| `user` with string content | a new turn. `origin.kind` is `human`, `peer` or `task-notification`. Records with `isMeta` and `<local-command…>` records are ignored. |
| `user` text `[Request interrupted…` | turn interrupted; open tools are cleared. |
| `api-request{querySource}` | a model call starts: `repl_main_thread` or `agent:builtin:<type>` means thinking, `compact` means compaction, anything else is a side query (ignored). Not written by 2.1.299. |
| `system/turn_duration{pendingBackgroundAgentCount}` | end of turn (2.1.302). |
| `system/stop_hook_summary` | end of turn (2.1.299 has no `turn_duration`). |
| `system/compact_boundary`, `system/api_error` | compaction done, API retry (seen in the binary, not on disk) |
| `queue-operation{content}` | may contain `<task-notification><task-id>ID</task-id><status>completed</status>` |
| `ai-title{aiTitle}`, `custom-title{customTitle}`, `agent-name{agentName}`, `summary{summary}` | titles |
| `cost-state` | written when the process exits. Only metadata records may follow it. |

- **Skipped before parsing:** `api-request-blob` (it repeats earlier blocks, including `tool_use`, so it must never be read as new activity), `api-request-shape`, `file-history-*`, `last-prompt` (prompt text), `atis-latch`, `mode`, `permission-mode`.
- **Ignored when it appears in a main transcript:** any record with `isSidechain: true` (this is the old format).
- **Permission prompts leave no trace** while they wait. Only the registry knows about them.

## Subagents: `<slug>/<sessionId>/subagents/agent-<agentId>.jsonl` + `.meta.json`

- **Meta fields:**
  - `agentType`, `description`, `toolUseId` (the parent's Agent call)
  - `spawnDepth`, `requestShape`, `requestNonInteractive`
  - `isFork` and `model` for forks
  - `finished: true` once the subagent is done
- **Records carry `agentId` and `isSidechain: true`.** Forks start with a `fork-context-ref` record and write no `api-request`.
- **A subagent is finished when any of these happens:**
  - `meta.finished === true`;
  - a task-notification arrives for its `agentId`;
  - the parent shows a synchronous `tool_result` for `meta.toolUseId`;
  - one of its own `user` records has `toolEndsTurn` (the `SubagentHandback` call);
  - its file has had no write for 10 min.
- **At startup, finished subagents are never shown.**

## Fallbacks

- **Registry folder missing (older versions):** every session is inferred from transcripts written in the last 10 minutes that don't end with `cost-state`, and gets `inferred: true`.
- **Transcript not found yet:** the registry status alone gives the state.
- **Unknown record types** are ignored.
- **Tool names:** both `Task` and `Agent` are treated as subagent launches (`src/shared/tools.js`).

## Tokens and cost (`src/main/tracker/usage.js`)

- **Per response:** assistant lines carry `message.id`, `message.model` and `message.usage`: `input_tokens`, `output_tokens` (thinking included), `cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `server_tool_use.{web_search_requests, web_fetch_requests}`, `speed` (`standard`/`fast`), `service_tier`.
- **Duplicates:** a response with several content blocks is written as several lines repeating the same id and usage. Count each id once per session; a session moved to another project folder repeats its earlier lines too.
- **`cost-state`** (written when a run ends): `totalCostUSD`, `startTime`, `totalDuration`, `modelUsage.<model>.{inputTokens, outputTokens, thinkingTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD}`, `hasUnknownModelCost`. It is Claude Code's own exact figure: inside a finished run it replaces the estimate.
- **Prices checked against cost-state on 2026-10-23** ($ per million tokens, input / output / cache read / cache write 5 min / 1 h): Opus 5.5 4 / 20 / 0.2 / 5 / 8; Sonnet 5.5 2 / 10 / 0.1 / 2.5 / 4; Haiku 5.5 0.1 / 0.5 (5x above 100K prompt tokens). Web search: $0.01 each. Fast mode: 2x. The main thread writes 1 h cache entries, subagents 5 min ones.
- **Not in transcripts:** some background calls (auto-mode checks, titles). On this PC the recomputed totals were 5 to 26 % below Claude Code's own.
