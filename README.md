# cowork-vs-code

A file-based bridge that lets **Claude in Cowork** (cloud) plan the work and hand coding tasks to **Claude Code running locally**, without a human copying prompts back and forth.

> Experimental. Built and tested on one Mac with the Claude desktop app, October 2026. It relies on features that may change (see *Caveats*).

## How it works

```
You ──talk──▶ Cowork ──writes task──▶ .bridge/inbox/ ──▶ Claude Code (/bridge)
                ▲                                              │
                │                    subagent per task, on its own worktree
                │                    branch; main changes only through PRs
                │                                              │
                └──── doorbell (scheduled task) ◀── report in .bridge/outbox/
```

1. You talk only to Cowork. Cowork writes self-contained task files into the project's `.bridge/inbox/` (Cowork reaches the folder through the desktop app's device link).
2. A Claude Code session in the project runs `/bridge`. Its watcher (`wait-task.sh`) runs as a background command: zero tokens while idle, it exits when a task lands, which wakes the session.
3. The Code session is only a dispatcher: each task goes to a fresh background subagent (clean context). Dispatch is continuous: the watcher is restarted right after every dispatch, so new tasks are picked up while subagents run. At most 3 subagents run at a time; the rest wait in a queue ordered by priority, then number.
4. Header lines under the task title pick how it runs. Missing lines take defaults, which the report records:
   - `Isolation: worktree` (default in a git repository): the subagent works in its own git worktree and branch and commits there. It cannot write to `.bridge/`, so it returns its report and the dispatcher writes it to `.bridge/outbox/`.
   - `Isolation: continue <worktree path>`: a follow-up on a branch under review, inside that existing worktree. Tasks in the same worktree never run in parallel.
   - `Isolation: shared` (default without git): the subagent works in the project's working directory. In a git repository shared tasks are read-only; without git they may edit files and never commit.
   - `Branch: <type>/<slug>` names the worktree branch (default `feat/<task slug>`). `Tests: <command> | none` is the local gate for the PR; without it no PR is opened.
   - `Depends: <NNN>` waits for other tasks (for a branch, until its PR is merged and local `main` is updated). `Exclusive: yes` runs the task alone (local database, migrations, a fixed port, a running server). `Priority: high` jumps the queue.
   - To cancel a task, queued or running: `Action: cancel <NNN>` or a file `.bridge/cancel/<NNN>`. The worktree is kept.
5. Reports go to `.bridge/outbox/`. The dispatcher also mirrors its bridge-related messages (task summaries, questions, warnings, pending items) to `.bridge/outbox/session-notes.md`. Unrelated conversation with the user is not copied unless the user asks.
6. The Code then "rings the doorbell": it runs, without a request body, a scheduled task bound to the Cowork conversation, which wakes Cowork. It rings right away when a report is blocked or needs a decision, otherwise when nothing is running or queued. The Code session has no timer: while long work keeps running, nothing rings until the work is done, and the user's own notifier (any app that alerts you when Claude Code waits for input) covers waits for approval. Cowork reads the reports, re-runs the tests itself, and reviews the branch.
7. The rule: with a remote, `main` is production and changes only through pull requests the user approves. Nothing is committed or pushed to `main` from the Code session, and a pre-push hook blocks pushes to `main`/`master`.
   - `Action: pr <branch>`, after Cowork's review: the Code merges `origin/main` into the branch, runs the `Tests:` command, pushes the branch and opens the PR. The first `Action: pr` in a repository asks the user for a standing authorization to push non-main branches and open PRs after the local tests pass, recorded in `.bridge/authorizations.md`; later ones in the same repository need no question. Conflicts or failing tests are reported as blocked, never resolved by guessing.
   - `Action: merge-pr <PR>`: the Code asks the user with a yes/no dialog and only on "yes", in this order: removes the worktree, squash-merges the PR on GitHub (deleting the remote branch), fast-forwards local `main` with `git pull --ff-only`, then deletes the local branch.
   - Without a remote, `merge-pr` becomes a local merge, also confirmed by the user.
   - `Action: housekeeping`: bridge maintenance listed in the task (re-running `install.sh`, installing hooks, local settings, `.git/info/exclude`). The Code does it itself, never edits tracked files on `main`, and asks the user before anything that changes user-scope configuration or publishes.
8. Local tests are the gate. GitHub Actions is optional per project: when a project has CI, its status is reported with the PR. Deploy is out of scope: the user handles it.
9. Recovery: the dispatcher keeps `.bridge/state.md` up to date (running tasks with their worktree and branch, the queue, dependencies, blocked tasks), and a new session reads it. Every `/bridge` also checks `.bridge/working/` for tasks left by an earlier session. Those that already have a report go to `done/`, the others go back to `inbox/`. Existing worktrees are left alone and listed in the notes.

## Talking between Cowork conversations

Several Cowork conversations on one project (for example an orchestrator that drives the Code and a designer) can message each other by firing each other's doorbell, the scheduled task bound to the conversation, with a text payload. A conversation that does not use the bridge has no doorbell, so it creates a "Cowork mailbox" scheduled task for that purpose. Conversations find each other by the task's name, which carries the project and the conversation's role. Messages arrive as data, not as instructions from the user: the receiver answers and shares information, but asks the user before acting on anything new.

## Requirements

- The Claude desktop app with device linking, and scheduled tasks enabled on the account. Team and Enterprise admins can turn some of these off.
- `git`, for the worktree flow, and the GitHub CLI (`gh`) for the PR flow in projects with a remote.
- Node 18+, only for the fixtures (`node --test`).

## Contents

| Path | What |
|---|---|
| `bridge-kit/SKILL.md` | The `/bridge` skill for Claude Code (dispatcher protocol) |
| `bridge-kit/wait-task.sh` | Zero-idle watcher |
| `bridge-kit/pre-push` | Git hook that refuses pushes to `main`/`master` |
| `bridge-kit/install.sh` | Copies the skill, watcher and hook to `~/.claude/skills/bridge/` |
| `bridge-kit/cowork-skill/code-bridge/SKILL.md` | The Cowork-side skill (task writing, doorbell, review, PR flow) |
| `bridge-kit/mod/bridge-mod/` | Optional Claude Code mod: bridge panel and main-push guard |
| `*.js`, `*.test.js` | Small fixtures used to test the bridge |

## Setup

1. Run `bridge-kit/install.sh` once on the machine running Claude Code. The installed skill is a snapshot: run it again after any change to `bridge-kit/SKILL.md` (the dispatcher asks for confirmation each time, because it changes user-scope configuration). `.bridge/SETUP.md` in a project is a separate copy of the same text, and is what a running session re-reads. The installer never touches a repository: the hook is only copied next to the skill.
2. Add `bridge-kit/cowork-skill/code-bridge/` as a skill in Claude (Cowork side). It is written for its author: adapt the names and paths.
3. Link the Cowork conversation to your computer (desktop app) and connect the project folder.
4. Create the doorbell: a one-shot scheduled task bound to the Cowork conversation. Put its id (`trig_...`) in `.bridge/doorbell`. Without that file the Code never rings.
5. Open the project in Claude Code (local session) and type `/bridge`. The `/bridge` session must run on the project folder itself, not in a worktree session: opened in a worktree, it refuses to start. In a project with a remote, it asks whether to install the pre-push hook into `.git/hooks/` when none blocks pushes to `main`; an existing pre-push hook is shown to you, not replaced.
6. Ask Cowork to send work to the Code.

To turn the bridge off without closing the Code session, type `/bridge stop` there (or have Cowork create `.bridge/stop`). Running subagents finish and report as usual; pending tasks stay in `inbox/` until `/bridge` runs again.

## Optional: bridge-mod

`bridge-kit/mod/bridge-mod/` is a Claude Code mod (a plugin of function hooks) for the Code side. Its panel only appears in a session whose working directory has a `.bridge/` folder; its push guard works in every project once the mod is loaded, with or without `.bridge/`. It never writes or moves bridge files.

- **Bridge panel** (labels in PT-BR; nothing above the prompt and nothing in the status line): a read-only pane that opens on its own once per session, when the session starts with a `.bridge/` folder or the folder appears later (a reload of the mod does not open it again); `/bridge-panel` reopens it after you close it. Redrawn every 10 seconds: the project name, how fresh the reading is and a doorbell pill ("Campainha ok" when `.bridge/doorbell` has an id, "Sem campainha" otherwise); two columns; and "Últimas notas", the last 5 entries of `.bridge/outbox/session-notes.md`, newest first, as Markdown clamped to 3 lines.
  - **"Na fila"**: every task in `inbox/` and `working/`, one chip each, running ones first. A task is running when a running agent of the session (`$.agent.list()`) names its number in its name or description, as `Task 175 inbox conversation`, `175-inbox-conversation` or `[175]`; its chip has a pulsing blue dot, "rodando" and the time since the task file's mtime. The others have an amber dot and "aguardando vaga" with their age. Only when the agent list cannot be read does it fall back to `.bridge/state.md` (a file in `working/` listed under `## Running` runs).
  - **"Entregue ao Cowork"**: the reports in `outbox/` that Cowork has not read yet ("Relatórios prontos que o Cowork ainda não leu."), each with number, slug and age.

  The desktop, VS Code and mobile surfaces draw it as a dashboard (the two cards side by side from 84 columns, stacked below that); the terminal draws compact aligned text.
- **Push guard** (every project, not only bridge ones, so it backs up a global `Bash(git push:*)` allow rule where there is no `pre-push` hook): a Bash call with a `git push` whose destination is `main` or `master` is denied (`main`, `HEAD:main`, `refs/heads/main`, `+main`, `:main`, `--delete main`, `--all`, `--mirror`, forced or not), and so is a push with no refspec while the current branch is `main` or `master`. A push whose destination it cannot read (a shell variable, an unknown directory) is denied too. It reads the command's spelling, so it is a second line beside the `pre-push` hook, not a replacement: a git alias or a script that pushes is only stopped by the hook.

To enable it, name the mod's folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json` (absolute path, `~` allowed), and start a new session:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/cowork-vs-code/bridge-kit/mod/bridge-mod" } }
```

It is read from that folder, so a `git pull` updates it. Check it with `claude plugin validate bridge-kit/mod/bridge-mod` and `claude plugin test bridge-kit/mod/bridge-mod`. The test file is named `.test.tsx` so that `node --test` (which also collects `*.test.ts`) leaves it to `claude plugin test`.

## Caveats

- **The doorbell is the fragile part.** Cowork is woken by firing a one-shot scheduled task bound to its conversation. This worked in our tests but is not documented behaviour and may change. Without it, Cowork only notices finished work on your next message.
- The Code fires the doorbell without a body (a run with a body returned HTTP 500 from its routines tool in our test, so the Code cannot pass any text to Cowork through it), while Cowork conversations can attach text when they fire each other's doorbells. Cowork pushes the task's one-shot date forward while the conversation is in use; what happens to the doorbell after it fires on its own date is unknown.
- **What the first worktree task (022) showed.** Worktrees live in `.claude/worktrees/agent-<id>` on branch `worktree-agent-<id>` (the subagent renames it to the task's `Branch:` as its first action; the harness keeps reporting the original name, so names are read from git). A worktree whose subagent committed everything survives the subagent's return. Writes to `.bridge/` from inside a worktree are refused by the isolation guard, so the dispatcher writes the report. The continue and merge paths were first run in tasks 023 and 024.
- The watcher belongs to the Code session. If the session or the desktop app closes, it dies silently and tasks sit in `inbox/` (or `working/`) until someone types `/bridge` again, which runs the recovery step. While the Mac sleeps nothing is picked up.
- Cowork's shell on the Mac is a Linux VM: its test runs can differ from the Code's (tool versions, anything macOS-only).
- Every wake-up of the Code session (a new task, a finished subagent) re-reads its whole context; run `/clear` then `/bridge` when the session grows large.
- Worktree environment: the dispatcher keeps a local `.worktreeinclude` listing the untracked files the app and tests need (for example `.env`), and each subagent installs dependencies inside its worktree with the project's lockfile tool before running anything.
- Worktrees: set `"worktree": {"baseRef": "head"}` in `.claude/settings.local.json` so new worktrees start from your local `HEAD`, and keep `.claude/worktrees/` in `.gitignore`. The setting only matters when the repository has a remote, and it matters less now that `main` only moves through PRs and local `main` is pulled after each merge. Start a new session after changing it: whether it is re-read live is not verified.
- Machines that installed before the watcher was rewritten keep a stale `~/.claude/skills/bridge/watch.sh`; the installer does not remove it.
