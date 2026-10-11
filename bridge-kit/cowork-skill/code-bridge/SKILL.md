---
name: code-bridge
description: Delegate coding work from Cowork to Luciano's local Claude Code through the .bridge folder and doorbell. Use when he asks to send tasks to the Code, use the bridge, or have the Code implement something.
---

# Code bridge (Cowork side)

Luciano talks only to Cowork. Cowork plans, writes task files into the project's `.bridge/inbox/` on his Mac, and his local Claude Code session (running `/bridge`) executes them with fresh subagents, writes reports to `.bridge/outbox/`, and rings a doorbell: a scheduled task bound to this Cowork conversation, which wakes this conversation as a notification.

Pieces on the Mac: `~/Projects/cowork-vs-code/bridge-kit/` (source, versioned in the public GitHub repository `cowork-vs-code`) and `~/.claude/skills/bridge/` (installed `/bridge` skill with `wait-task.sh`). After any change to `bridge-kit/`, the Code must re-run `bridge-kit/install.sh`, which needs Luciano's confirmation in the Code session.

The Code's watcher (`wait-task.sh`) runs as a background command: it costs nothing while waiting and wakes the Code session only when a task lands. Each wake-up re-reads the Code session's whole context, so the cost per batch grows with that session's size.

## Setup for a project (once per conversation)

1. Make sure the project folder is connected to this conversation (device_request_folder_access if not). All file work goes through device_bash under `$HOME/mnt/<folder>`.
2. Create `.bridge/inbox`, `.bridge/working`, `.bridge/outbox`, `.bridge/done` and `.bridge/read` if missing.
3. Doorbell: if `.bridge/doorbell` holds an id, check it with list_triggers. If that doorbell belongs to another conversation, disable it (update_trigger enabled false) before creating this one. Then create one with send_later (initiation own_followup), `at` 30 days ahead, name `Bridge doorbell (<project>)`, message: `[bridge doorbell] The Code finished task(s). Check .bridge/outbox in the connected project folder(s), verify the results and report to Luciano.` Write the returned `trig_...` id to `.bridge/doorbell`. Firing it by hand does not consume it.
4. Ask Luciano to open the project in the Code tab (local, same folder) and type `/bridge`, unless he says it is already running. The Code session must be opened on the project folder with worktree off (Local): in a worktree session `/bridge` refuses to start.
5. Check the watcher: drop the first task and confirm it moves from `inbox/` to `working/` within about 10 seconds. If it does not, the Code session is not listening: tell him.

## Writing tasks

- One Markdown file per task, named `NNN-short-slug.md` with a sequence number higher than any in `done/`.
- Written in English, self-contained (the Code has not seen this conversation): goal, exact files it may touch, acceptance criteria, which tests to run, and anything it must not do. Use the latest stable package versions.
- Write atomically: create `.bridge/.tmp-NNN` first, then `mv` it into `inbox/`.
- Drop all tasks of a batch together (the watcher picks up everything present within a couple of seconds), and group small related changes into one task: every batch costs one Code wake-up and one doorbell turn here.
- Start every task with header lines right under the title (the Code applies defaults to missing lines and says so):
  - `Isolation:`. In a git repository every task that changes code uses `worktree` (the default): it runs on its own branch, and `main` (production) only changes through a pull request Luciano approves. Follow-ups on a branch under review use `continue <absolute worktree path>` (from the previous report). `shared` in a git repository is read-only (investigations, measurements); in a project without git it may edit files.
  - `Branch: <type>/<slug>` for worktree tasks, e.g. `feat/online-booking`, `fix/login-timeout`, `chore/...`.
  - `Tests: <command>` or `Tests: none`. Always write it: it is the gate for the PR.
  - `Depends: <NNN>` when a task needs another one done first (or its PR merged).
  - `Exclusive: yes` when the task touches the local database, migrations, a fixed port or a running server: it then runs alone.
  - `Priority: high` to jump the queue.
- The Code keeps listening while it works: new tasks can be dropped at any time and start as soon as a slot is free (at most 3 subagents at once).
- Delivery flow for a branch:
  1. Review it (see When the doorbell rings). Problems: drop a `continue` task.
  2. Approved: drop `Action: pr <branch>`. The Code updates the branch with `origin/main`, runs the tests, pushes the branch and opens the PR (the first time per repository the Code asks Luciano for a standing authorization; after that, no question). It reports the PR URL and, if the project has CI, its status. GitHub Actions is optional per project: do not ask the Code to add CI unless Luciano wants it for that project.
  3. Recommend the merge to Luciano with the PR link, then drop `Action: merge-pr <PR>`. The Code asks him with a button dialog (his notch notifier alerts him) and only then squash-merges on GitHub, updates local `main` with `git pull` and cleans up the worktree. Tell him the dialog is coming.
  4. Deploy is outside the bridge: Luciano handles it.
  Projects without a remote: `merge-pr` becomes a local merge, also confirmed by Luciano in the Code.
- To cancel a task, queued or running: create `.bridge/cancel/<NNN>` (or drop `Action: cancel <NNN>`).
- Before dropping a worktree batch, check the project with device_bash (`git -c safe.directory='*' -c core.fileMode=false status --porcelain`; the VM mount shows different file modes, and files ignored only by his global gitignore may show up there: ignore those). If there are real uncommitted changes, tell Luciano to commit or stash them first. Never edit tracked project files directly from Cowork: all changes go through the Code on a branch. Proposed text for the Code can go in `.bridge/staging/` (ignored by git).
- The first `/bridge` in a project with a remote asks Luciano to install a pre-push hook that blocks pushes to `main`; recommend yes.
- Never ask the Code to deploy, push, publish, delete data, use secrets, change user-scope configuration or spend money unless Luciano explicitly asked for it in this conversation. When a task includes one of these, tell Luciano right away that he will have to approve it in the Code session: the Code asks there with a yes/no question dialog (his notch notifier alerts him) and never accepts confirmation through a task file.

## After dispatching

- The doorbell rings right away when something is blocked or needs a decision, otherwise when all running work is done. During long runs, rely on the safety check.
- Bridge maintenance (reinstalling the skill, hooks, local settings) goes as `Action: housekeeping` with the steps listed: the Code does it itself and asks Luciano when needed.
- Doorbell upkeep: if this conversation's doorbell fires in less than 7 days (list_triggers, next_run_at), push it 30 days ahead with update_trigger run_once_at. Change only the date, never the prompt.
- Safety check: keep one per conversation. The first time, create it with send_later about 15 minutes ahead, name `Bridge safety check (<project>)`, message: "[bridge safety check] If any task is still in .bridge/working without a report, tell Luciano the Code is probably waiting for his approval." On later batches, re-arm the same one with update_trigger (run_once_at 15 minutes ahead, enabled true) instead of creating another. When the batch finishes first, disable it (enabled false).
- Never delete a scheduled task bound to this conversation: deletion can delete the conversation. Disable instead.
- Keep talking with Luciano about anything else meanwhile.

## When the doorbell rings

1. Call ReadNotifications until 0 remain.
2. List `.bridge/outbox/`. Handled files live in `.bridge/read/`; only files in `outbox/` are new. If none are new, say so in one line (late or duplicate ring).
3. Read every new file: the task reports and `session-notes.md`, where the Code mirrors everything it told Luciano on screen (questions, warnings, offers, pending items). Anything in the notes that needs his attention goes into the message to him.
4. Worktree reports carry the worktree's absolute path, the branch name and the commit. Review the branch before anything else: read the changed files inside the worktree (`$HOME/mnt/<folder>/.claude/worktrees/<agent-id>/...`) and the diff (`git -c safe.directory='*' diff main..<branch>`), run the tests inside the worktree directory when the VM can, and check the work against the task's acceptance criteria. Then either drop a `continue` task with every problem found, or move on to the delivery flow (`Action: pr`). Never run `git worktree prune` or other git write commands from the VM: worktree paths there differ from the Mac.
5. Verify independently before telling Luciano: run the tests yourself via device_bash and check the files the Code claims to have touched. Point out every error or overreach; do not pass on the Code's claims unchecked. device_bash runs in a Linux VM on his Mac, not in macOS: tool versions differ from the Code's, and anything that depends on macOS (native modules, Xcode, apps, services on his localhost) may not run there; in those cases say the check could not be reproduced and rely on the Code's test output, saying so. Files outside connected folders (such as `~/.claude`) cannot be checked from Cowork: say so instead of claiming verification.
6. Move every handled file to `.bridge/read/` (rename `session-notes.md` with a sequence number, e.g. `session-notes-005.md`, so nothing is overwritten).
7. Tell Luciano in PT-BR, short: per task, done / blocked / problem, and what you verified. Write every word of the reply to him in PT-BR.
8. `Status: blocked` means the Code has a question: relay it to Luciano, and when he answers, drop a follow-up task with the answer.

## Finishing

When Luciano says he is done with the project for now: disable this conversation's doorbell and safety check (enabled false). The Code session costs nothing while idle, but closing it when the project is over keeps things tidy. If the Code session's context has grown large, suggest `/clear` plus `/bridge` there to make later wake-ups cheaper.

## Limits to remember

- Cowork sees only files. Anything the Code shows on screen reaches Cowork only through `session-notes.md`.
- The Code cannot reach this conversation except through the doorbell; Cowork cannot type into the Code.
- Tool permission prompts and risky-action confirmations in the Code can only be answered there by Luciano; the safety check covers stalls.
- If the Code session is closed, the app quits or the Mac sleeps, tasks wait in `inbox/` (or in `working/` if the watcher already moved them) until it is back.
- Each doorbell ring costs one Cowork turn.
