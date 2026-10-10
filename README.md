# cowork-vs-code

A file-based bridge that lets **Claude in Cowork** (cloud) plan the work and hand coding tasks to **Claude Code running locally**, without a human copying prompts back and forth.

> Experimental. Built and tested on one Mac with the Claude desktop app, October 2026. It relies on features that may change (see *Caveats*).

## How it works

```
You ──talk──▶ Cowork ──writes task──▶ .bridge/inbox/ ──▶ Claude Code (/bridge)
                ▲                                              │
                │                          subagent per task, commits on a branch
                │                                              │
                └──── doorbell (scheduled task) ◀── report in .bridge/outbox/
```

1. You talk only to Cowork. Cowork writes self-contained task files into the project's `.bridge/inbox/` (Cowork reaches the folder through the desktop app's device link).
2. A Claude Code session in the project runs `/bridge`. Its watcher (`wait-task.sh`) runs as a background command: zero tokens while idle, it exits when a task lands, which wakes the session.
3. The Code session is only a dispatcher: each task goes to a fresh subagent (clean context), in parallel when safe. Big tasks run in their own git worktree and branch.
4. Reports go to `.bridge/outbox/`, and everything the Code says on screen is mirrored to `session-notes.md`.
5. The Code then "rings the doorbell": it runs a scheduled task bound to the Cowork conversation, which wakes Cowork. Cowork reads the reports, re-runs the tests itself, and reviews the branch.
6. Nothing reaches `main` until Cowork approves and sends an explicit merge task. Merges are local; push, deploy, publish and anything irreversible need the human's confirmation in the Code session (asked with a yes/no dialog).

## Contents

| Path | What |
|---|---|
| `bridge-kit/SKILL.md` | The `/bridge` skill for Claude Code (dispatcher protocol) |
| `bridge-kit/wait-task.sh` | Zero-idle watcher |
| `bridge-kit/install.sh` | Copies the skill and watcher to `~/.claude/skills/bridge/` |
| `bridge-kit/cowork-skill/code-bridge/SKILL.md` | The Cowork-side skill (task writing, doorbell, review, merge) |
| `*.js`, `*.test.js` | Small fixtures used to test the bridge |

## Setup

1. Run `bridge-kit/install.sh` once on the machine running Claude Code.
2. Add `bridge-kit/cowork-skill/code-bridge/` as a skill in Claude (Cowork side). It is written for its author: adapt the names and paths.
3. Link the Cowork conversation to your computer (desktop app) and connect the project folder.
4. Open the project in Claude Code (local session) and type `/bridge`.
5. Ask Cowork to send work to the Code.

## Caveats

- **The doorbell is the fragile part.** Cowork is woken by firing a one-shot scheduled task bound to its conversation. This worked in our tests but is not documented behaviour and may change. Without it, Cowork only notices finished work on your next message.
- Needs the Claude desktop app with device linking, and scheduled tasks enabled on the account. Team and Enterprise admins can turn some of these off.
- Cowork's shell on the Mac is a Linux VM: its test runs can differ from the Code's (tool versions, anything macOS-only).
- Each batch wakes the Code session once and re-reads its whole context; run `/clear` then `/bridge` when the session grows large.
- Worktrees: set `"worktree": {"baseRef": "head"}` in `.claude/settings.local.json` so new worktrees start from your local `HEAD`, and keep `.claude/worktrees/` in `.gitignore`.
