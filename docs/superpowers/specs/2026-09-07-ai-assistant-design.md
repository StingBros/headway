# AI assistant — design

An in-app assistant that answers questions about Headway, the open project and
project-management practice, and edits the document or personal preferences on
request. Lives in `js/ai.js` (`window.HeadwayAI`), following the `js/jira.js`
module shape: pure, node-testable pieces plus browser glue.

## Providers (personal setting, this machine only)

- **LiteLLM gateway** — OpenAI-compatible `chat/completions` with streaming,
  native function calling and `reasoning_effort`. Settings: base URL, API key,
  model (picked from `GET /v1/models` or typed), optional extra headers.
  Reasoning arrives as `reasoning_content` / `thinking_blocks` deltas and is
  shown as a collapsible "Thinking" block; thinking blocks are replayed on
  later requests so Anthropic models keep tool-use turns valid.
- **Claude subscription** — desktop only. Runs `claude -p` through the Rust
  bridge in `main.rs` (`HeadwayDesktop.claude`): one long-lived process per
  conversation speaking stream-json on stdin/stdout, built-in tools disabled,
  `--system-prompt`, `--model`, `--effort`. Headway tools are exposed through a
  text protocol: the model writes ```` ```headway-tool ```` fenced JSON calls,
  the app runs them and answers in the next user turn. Stop kills the process;
  the next turn resumes the session id.

Effort (low / medium / high / max) and model are picked in the drawer header
and remembered.

## Tools (shared by both providers)

| tool | purpose |
|---|---|
| `get_project` | summary, or `meta` / `phases` / `team` / `items` (full, by num) / `validation` / `history` |
| `get_preferences` | UI snapshot + personal prefs + the option lists the UI offers |
| `add_items` | create features (with stories, ISO dates, deps) in a phase |
| `update_items` | merge fields into features or stories by num (ISO `start` / `end` conveniences) |
| `update_project` | path-addressed `set` / `delete` / `push` ops on any part of the document (meta, phases, team, holidays, sizing, columns, colors, icons, Jira mapping…) |
| `set_preference` | personal prefs via `HeadwayApp.ai.setPref` (theme, snap, arrows, grouping, colour mode…) |
| `navigate` | switch view, select an item |
| `sync_jira` | preview (`dryRun`) or run the Jira Cloud sync when a connection and project key exist |

Paths use `/` segments: `items/#12/feature` (item by num), `items/#12/stories/@s1/done`
(by id), `phases/@p1/name`, `meta/holidayRanges/0`, `wsColors/Data`. Every write
runs `RM.normalizeState` and lands through `HeadwayApp.ai.commit`, so it is
undoable and appears in Version history as "<name> · AI". The result reports
what changed plus validation counts so the model can react.

## UI

A right-hand drawer (`#aiDrawer`, resizable, persists across views) toggled by
the toolbar AI button. Messages: user bubbles with attachment chips; assistant
blocks with a collapsible thinking section, light markdown, `#12` references
that select the item, and tool cards (what was read / changed, expandable).
Composer: Enter sends, Shift+Enter breaks, attach button / drag-drop / paste
for images, PDFs and text files. The toolbar button spins while a turn runs
and shows a dot when a reply lands with the drawer closed.

Setup → Personal → AI assistant holds the provider settings. The conversation
survives a reload (files keep names only).
