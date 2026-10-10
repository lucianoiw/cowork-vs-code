# cowork-vs-code

A file-based bridge that lets **Claude in Cowork** (cloud) plan the work and hand coding tasks to **Claude Code running locally**, without a human copying prompts back and forth.

> Experimental. Built and tested on one Mac with the Claude desktop app, October 2026. It relies on features that may change (see *Caveats*).

## How it works

```
You ──talk──▶ Cowork ──writes task──▶ .bridge/inbox/ ──▶ Claude Code (/bridge)
                ▲                                              │
                │                    subagent per task; in git, commits on a
                │                    worktree branch (shared mode: no review)
                │                                              │
                └──── doorbell (scheduled task) ◀── report in .bridge/outbox/
```

1. You talk only to Cowork. Cowork writes self-contained task files into the project's `.bridge/inbox/` (Cowork reaches the folder through the desktop app's device link).
2. A Claude Code session in the project runs `/bridge`. Its watcher (`wait-task.sh`) runs as a background command: zero tokens while idle, it exits when a task lands, which wakes the session.
3. The Code session is only a dispatcher: each task goes to a fresh subagent (clean context). The task header picks the mode:
   - `Isolation: worktree`: the subagent works in its own git worktree and branch and commits there. Worktree tasks may run in parallel with each other, never in the same batch as shared tasks.
   - `Isolation: shared` (the default when the line is missing): the subagent works directly in the project's working directory. In a git repository shared tasks run one after the other and each commits straight to the current branch, with no review. Outside git they may run in parallel only if their file scopes do not overlap.
4. Reports go to `.bridge/outbox/`. The dispatcher also mirrors its bridge-related messages (task summaries, questions, warnings, pending items) to `.bridge/outbox/session-notes.md`. Unrelated conversation with the user is not copied unless the user asks.
5. The Code then "rings the doorbell": it runs, without a request body, a scheduled task bound to the Cowork conversation, which wakes Cowork. It rings once per batch, not once per task. Cowork reads the reports, re-runs the tests itself, and reviews the branch.
6. The rule: in git repositories every project task runs in a worktree and reaches `main` only after Cowork's review and an explicit merge task; shared mode is only for bridge housekeeping or projects without git. Merges are local; push, deploy, publish and anything irreversible need the human's confirmation in the Code session (asked with a yes/no dialog).

## Requirements

- The Claude desktop app with device linking, and scheduled tasks enabled on the account. Team and Enterprise admins can turn some of these off.
- `git`, for the worktree flow.
- Node 18+, only for the fixtures (`node --test`).

## Contents

| Path | What |
|---|---|
| `bridge-kit/SKILL.md` | The `/bridge` skill for Claude Code (dispatcher protocol) |
| `bridge-kit/wait-task.sh` | Zero-idle watcher |
| `bridge-kit/install.sh` | Copies the skill and watcher to `~/.claude/skills/bridge/` |
| `bridge-kit/cowork-skill/code-bridge/SKILL.md` | The Cowork-side skill (task writing, doorbell, review, merge) |
| `*.js`, `*.test.js` | Small fixtures used to test the bridge |

## Setup

1. Run `bridge-kit/install.sh` once on the machine running Claude Code. The installed skill is a snapshot: run it again after any change to `bridge-kit/SKILL.md` (the dispatcher asks for confirmation each time, because it changes user-scope configuration). `.bridge/SETUP.md` in a project is a separate copy of the same text, and is what a running session re-reads.
2. Add `bridge-kit/cowork-skill/code-bridge/` as a skill in Claude (Cowork side). It is written for its author: adapt the names and paths.
3. Link the Cowork conversation to your computer (desktop app) and connect the project folder.
4. Create the doorbell: a one-shot scheduled task bound to the Cowork conversation. Put its id (`trig_...`) in `.bridge/doorbell`. Without that file the Code never rings.
5. Open the project in Claude Code (local session) and type `/bridge`.
6. Ask Cowork to send work to the Code.

## Caveats

- **The doorbell is the fragile part.** Cowork is woken by firing a one-shot scheduled task bound to its conversation. This worked in our tests but is not documented behaviour and may change. Without it, Cowork only notices finished work on your next message.
- The doorbell is fired without a body: a run with a body returned HTTP 500 in our test, so the Code cannot pass any text to Cowork through it. Cowork pushes the task's one-shot date forward while the conversation is in use; what happens to the doorbell after it fires on its own date is unknown.
- **The worktree flow is not verified end to end.** The first worktree task is only now being run; the continue and merge paths have never been run. Still unverified: whether a worktree whose subagent committed everything survives the subagent's return, what branch names look like, and whether writing to `.bridge/` from inside a worktree raises permission prompts.
- The watcher belongs to the Code session. If the session or the desktop app closes, it dies silently and tasks sit in `inbox/` until someone types `/bridge` again. While the Mac sleeps nothing is picked up.
- Cowork's shell on the Mac is a Linux VM: its test runs can differ from the Code's (tool versions, anything macOS-only).
- Each batch wakes the Code session once and re-reads its whole context; run `/clear` then `/bridge` when the session grows large.
- Worktrees: set `"worktree": {"baseRef": "head"}` in `.claude/settings.local.json` so new worktrees start from your local `HEAD`, and keep `.claude/worktrees/` in `.gitignore`. The setting only matters when the repository has a remote. Start a new session after changing it: whether it is re-read live is not verified.
- Machines that installed before the watcher was rewritten keep a stale `~/.claude/skills/bridge/watch.sh`; the installer does not remove it.
