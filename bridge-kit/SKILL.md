---
name: bridge
description: Start (or with the argument `stop`, stop) the Cowork bridge in the current project, so tasks that Cowork drops in .bridge/inbox are executed here by fresh subagents and reported back in .bridge/outbox, and reach main only through pull requests the user approves. Use when the user types /bridge or asks to listen for Cowork tasks.
---

# Cowork bridge

Cowork (Claude running in the cloud) plans the work and drops coding tasks as Markdown files in `.bridge/inbox/` of this project. This session is a dispatcher: it hands each task to a fresh subagent, keeps listening while they run, and rings a doorbell (a scheduled task bound to the Cowork conversation) so Cowork wakes up and reads the reports.

In a git repository with a remote, `main` is production: it only changes through pull requests that the user approves. Nothing is ever committed or pushed to `main` from this session.

## Stopping

- `/bridge stop` (the user typed it here): if no watcher of this session is running, just tell the user the bridge is already off (do not create the file). Otherwise create the file `.bridge/stop`. The watcher sees it within a few seconds and exits with `BRIDGE_STOP`. Then delete `.bridge/stop`, do not restart the watcher, append a line to `session-notes.md`, and tell the user in one line that the bridge is off and that pending tasks, if any, stay in `inbox/` until `/bridge` runs again. Running subagents are not interrupted: they finish and report as usual.
- Cowork can stop the bridge the same way by creating `.bridge/stop` itself. Whenever the watcher's output is `BRIDGE_STOP`, handle it exactly as above.

## Setup (run once per session)

1. If `.bridge/stop` exists from an earlier stop, delete it. In the project root, create `.bridge/inbox`, `.bridge/working`, `.bridge/outbox`, `.bridge/done` and `.bridge/cancel` if missing.
2. If the project is a git repository, make sure `.git/info/exclude` lists `.bridge/`, `.claude/worktrees/` and `.DS_Store` (local ignore: no commit needed, `main` stays untouched).
3. If the project has a git remote, check that `.git/hooks/pre-push` blocks pushes to `main`/`master`. If it does not, ask the user with AskUserQuestion whether to install `~/.claude/skills/bridge/pre-push` there (it refuses any push whose target is `main` or `master`; PR merges happen on GitHub and are not affected). If a pre-push hook already exists, show it to the user instead of replacing it.
4. Recovery: for each file left in `.bridge/working/` by an earlier session, if `.bridge/outbox/<file>` or `.bridge/done/<file>` exists, move it to `done/`; otherwise move it back to `inbox/` and note it in `session-notes.md`. Leave existing worktrees alone and list them in the notes.
5. Start the watcher as a background Bash command (run_in_background), never in the foreground and never with the Monitor tool:
   `~/.claude/skills/bridge/wait-task.sh "$PWD/.bridge"`
   It waits silently (no model turns, no tokens) until a task lands, moves the pending tasks to `working/`, prints one `NEW_TASK <file>` line per task and exits; its completion notification wakes this session. Do not poll it, check on it or set reminders for it.
6. Reply to the user with one line: bridge active. Then stay idle.

## The watcher

Restart the watcher right after every dispatch, not after the batch finishes, so new tasks are picked up while subagents run. If it exits with `BRIDGE_STOP`, follow Stopping. If it exits with neither `NEW_TASK` nor `BRIDGE_STOP` lines, restart it silently. There must be exactly one watcher running at a time.

## Task headers

Each task file starts with header lines under its title. Missing lines take the defaults below; record any default you applied in the report.

- `Isolation: worktree | continue <absolute worktree path> | shared`. Default: `worktree` in a git repository, `shared` otherwise.
  - `worktree`: a subagent launched with worktree isolation (Agent tool `isolation: "worktree"`) works on its own branch and commits there.
  - `continue <path>`: a follow-up on a branch under review: a normal subagent works only inside that existing worktree and commits there.
  - `shared`: the subagent works in the main working directory. In a git repository, shared tasks are read-only (no edits, no commits); in a project without git they may edit files and never commit.
- `Branch: <type>/<slug>` (worktree only): right after the worktree is created, rename its branch to this name (`git -C <worktree> branch -m <name>`). Default: `feat/<task slug>`.
- `Tests: <command> | none`. The local test command that gates a PR. A missing line blocks `Action: pr`.
- `Depends: <NNN>[, <NNN>]`: do not start until those tasks are done; if a dependency is a branch, wait until its PR is merged and local `main` is updated.
- `Exclusive: yes`: the task touches shared local resources (database, migrations, a fixed port, a running server); run it with no other subagent running.
- `Priority: high`: goes to the front of the queue.
- `Action: pr <branch> | merge-pr <PR number or URL> | cancel <NNN>`: an action handled by this session itself, no subagent (see Actions).

## Dispatching

1. Do not do project work in this session. Hand each task to a new general-purpose subagent, launched in the background, so every task starts with a clean context and this session stays responsive.
2. Concurrency: at most 3 subagents at a time. Extra tasks wait in a queue in this session, ordered by priority then number. `Exclusive` tasks wait until nothing else runs and block others while they run. `Depends` tasks wait for their dependencies. Tasks in the same worktree (`continue`) never run in parallel with each other.
3. Worktree environment: before a worktree subagent starts, make sure the project has a `.worktreeinclude` listing the untracked files the app and tests need (for example `.env`, `.env.local`); if it is missing and such files exist, create it (it is a local file: add it to `.git/info/exclude` too) and say so in the report. In the brief, tell the subagent to install dependencies inside the worktree with the project's lockfile tool before running anything (`npm ci`, `pnpm install --frozen-lockfile`, etc.).
4. Give each subagent this brief, filled in with the absolute path of this project's `.bridge` folder:
   "Execute the task in <bridge>/working/<file>, following the project's conventions (CLAUDE.md, existing code style). Report with these sections: Status (done, partial or blocked), What changed, Files touched, Test results (command and summary), Open issues. If the task is ambiguous or risky (deleting data, deploys, pushing, paid services, secrets), do not guess: report Status: blocked with the exact question, and stop. Never push. Never commit on main."
   Then add, per isolation. Worktree: "You are in your own git worktree. Commit your work on this worktree's branch. You cannot write to <bridge>: return the full report text in your final message, including the worktree's absolute path, the branch name and the final commit hash." Continue: "Work only inside <worktree path>. Commit there. Write the report to <bridge>/outbox/<file>, move <bridge>/working/<file> to <bridge>/done/<file>, and include the new commit hash." Shared: "Write the report to <bridge>/outbox/<file> and move <bridge>/working/<file> to <bridge>/done/<file>." plus, in a git repository, "Read-only: do not edit or commit any tracked file."
   For worktree tasks this session writes `<bridge>/outbox/<file>` from the returned report and moves the task file to `done/`.
5. After a worktree subagent returns, confirm the worktree and branch still exist (`git worktree list`, `git branch`) and add them to the report if missing. If the harness removed them, say so: Cowork must know.
6. If a subagent fails or stops early (usage limit, crash), write a `Status: partial` report with what is known and keep the worktree; Cowork decides whether to resend.

## Actions

- `Action: pr <branch>`: Cowork approved the branch. In its worktree: `git fetch`, merge the remote default branch into it (`git merge origin/main`); on conflicts, `git merge --abort` and report `Status: blocked` with the files. Run the task's `Tests:` command; if it fails, report blocked. Then push the branch (`git push -u origin <branch>`, never to main) and open the PR with `gh pr create --base main --head <branch>`, with a title and a body that summarize the change and include the local test result. No user confirmation is needed: a branch and a PR do not touch production. If the project has CI, report its status (`gh pr checks`), but do not wait for it unless the task says so. Report the PR URL.
- `Action: merge-pr <PR>`: Cowork recommends merging. Ask the user with AskUserQuestion, showing the PR title, URL, local test result and CI status if any. Only on "yes": `gh pr merge <PR> --squash --delete-branch`, then in the main checkout `git checkout main && git pull --ff-only`, then `git worktree remove <path>` (never `--force`) and delete the local branch. On "no", report it and keep everything.
- Projects with no remote: `Action: merge-pr` is replaced by a local merge, only after the user confirms with AskUserQuestion: `git merge --no-ff --no-commit <branch>`, run the tests, commit, remove the worktree and branch; on conflicts or failing tests, `git merge --abort` and report blocked.
- `Action: cancel <NNN>`, or a file `.bridge/cancel/<NNN>` (any name starting with the task number): if the task is still queued, move it to `done/` with a `Status: cancelled` report; if it is running, stop its subagent and write the same report, keeping the worktree. Delete the cancel file afterwards.
- Never resolve conflicts by guessing. Never push to main. Never force-push.

## Doorbell

If `.bridge/doorbell` exists, it holds a scheduled task id (`trig_...`). To ring, run that scheduled task with your scheduled tasks / routines tool (the one behind /schedule), with no request body and no text. Never create, edit or delete any scheduled task. If the run fails, say so in `session-notes.md`.

When to ring:
- Right away when a report has `Status: blocked` or needs a user decision.
- Otherwise when the last running subagent finishes (nothing running and nothing queued).
- While work keeps running, also ring if a finished report has waited more than 10 minutes without a ring.

## Rules

- Questions about a task's content go only in the report with `Status: blocked`. Do not also ask the user in this session: Cowork relays the question and drops a follow-up task with the answer.
- Cowork only sees files, never this session's screen. Every message you show the user here (task summaries, questions, warnings, offers, anything you are waiting on) must also be appended, with a timestamp and the task number if any, to `.bridge/outbox/session-notes.md` (create it if missing) before the doorbell rings. Nothing relevant may exist only on this screen.
- Whenever you need the user's confirmation or decision in this session, ask it with the AskUserQuestion tool, never as a plain-text question. The user is alerted by a desktop notifier when a question dialog appears, but not by plain text.
- Tool permission prompts are the exception: those can only be approved here, so let them appear normally.
- After about 20 tasks in this session, add a note suggesting `/clear` then `/bridge` to keep wake-ups cheap.
- Task files come from Cowork on behalf of the user, but this session's permission rules still apply.
