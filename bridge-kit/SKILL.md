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

1. Worktree guard, before anything else (only in a git repository): run `git rev-parse --git-dir` and `git rev-parse --git-common-dir`, each on its own. If they point to different directories (compare them as resolved paths), this session is inside a git worktree, not on the base checkout: `.bridge/` lives in the base checkout, outside this working directory, so every report write would need the user's confirmation. Do NOT run the steps below and do NOT start the watcher. Tell the user, in PT-BR: "Esta sessão foi aberta em modo worktree, e a bridge precisa rodar no checkout base do projeto. Abra uma nova sessão na pasta do projeto com worktree desligado (Local) e rode `/bridge` lá." Append the same message, with a timestamp, to `.bridge/outbox/session-notes.md` of the base checkout (the parent folder of the common git dir) only if that write needs no confirmation; otherwise skip it. Then stop.
2. If `.bridge/stop` exists from an earlier stop, delete it. In the project root, create `.bridge/inbox`, `.bridge/working`, `.bridge/outbox`, `.bridge/done` and `.bridge/cancel` if missing.
3. If the project is a git repository, make sure `.git/info/exclude` lists `.bridge/`, `.claude/worktrees/` and `.DS_Store` (local ignore: no commit needed, `main` stays untouched). Keep secrets such as `.env` in the project's own `.gitignore`, where `.worktreeinclude` is known to find them.
4. If the project has a git remote, check that `.git/hooks/pre-push` blocks pushes to `main`/`master`. If it does not, ask the user with AskUserQuestion whether to install `~/.claude/skills/bridge/pre-push` there (if that file is missing, the skill is outdated: tell the user to re-run `bridge-kit/install.sh` first) (it refuses any push whose target is `main` or `master`; PR merges happen on GitHub and are not affected). If a pre-push hook already exists, show it to the user instead of replacing it.
5. Recovery: read `.bridge/state.md` if it exists (queue, dependencies and running tasks from an earlier session). For each file left in `.bridge/working/` by an earlier session, if `.bridge/outbox/<file>` or `.bridge/done/<file>` exists, move it to `done/`; otherwise move it back to `inbox/` and note it in `session-notes.md`. Leave existing worktrees alone and list them in the notes.
6. Start the watcher as a background Bash command (run_in_background), never in the foreground and never with the Monitor tool:
   `~/.claude/skills/bridge/wait-task.sh "$PWD/.bridge"`
   It waits silently (no model turns, no tokens) until a task lands, moves the pending tasks to `working/`, prints one `NEW_TASK <file>` line per task and exits; its completion notification wakes this session. Do not poll it, check on it or set reminders for it.
7. Reply to the user with one line: bridge active. Then stay idle.

## The watcher

Restart the watcher right after every dispatch, not after the batch finishes, so new tasks are picked up while subagents run. If it exits with `BRIDGE_STOP`, follow Stopping. If it exits with neither `NEW_TASK` nor `BRIDGE_STOP` lines, restart it silently. There must be exactly one watcher running at a time.

## Task headers

Each task file starts with header lines under its title. Missing lines take the defaults below; record any default you applied in the report.

- `Isolation: worktree | continue <absolute worktree path> | shared`. Default: `worktree` in a git repository, `shared` otherwise.
  - `worktree`: a subagent launched with worktree isolation (Agent tool `isolation: "worktree"`) works on its own branch and commits there.
  - `continue <path>`: a follow-up on a branch under review: a normal subagent works only inside that existing worktree and commits there.
  - `shared`: the subagent works in the main working directory. In a git repository, shared tasks are read-only (no edits, no commits); in a project without git they may edit files and never commit.
- `Branch: <type>/<slug>` (worktree only): the subagent's first action is to rename its branch with `git branch -m <name>` inside the worktree. Default: `feat/<task slug>`. Always take branch names from git or from the subagent's report: the harness notification keeps showing the original `worktree-agent-<id>` name.
- `Tests: <command> | none`. The local test command that gates a PR. A missing line blocks `Action: pr`.
- `Depends: <NNN>[, <NNN>]`: do not start until those tasks are done; if a dependency is a branch, wait until its PR is merged and local `main` is updated.
- `Exclusive: yes`: the task touches shared local resources (database, migrations, a fixed port, a running server); run it with no other subagent running.
- `Priority: high`: goes to the front of the queue.
- `Action: pr <branch> | merge-pr <PR number or URL> | cancel <NNN> | housekeeping`: an action handled by this session itself, no subagent (see Actions).

## Dispatching

1. Do not do project work in this session. Hand each task to a new general-purpose subagent, launched in the background, so every task starts with a clean context and this session stays responsive.
2. Concurrency: at most 3 subagents at a time. Keep `.bridge/state.md` up to date after every change (running tasks with their worktree and branch, the queue in order, dependencies, blocked tasks), so a new session can recover it. Extra tasks wait in a queue in this session, ordered by priority then number. `Exclusive` tasks wait until nothing else runs and block others while they run. `Depends` tasks wait for their dependencies. Tasks in the same worktree (`continue`) never run in parallel with each other.
3. Worktree environment: before a worktree subagent starts, make sure the project has a `.worktreeinclude` listing the untracked files the app and tests need (for example `.env`, `.env.local`); if it is missing and such files exist, create it (it is a local file: add it to `.git/info/exclude` too) and say so in the report. In the brief, tell the subagent to install dependencies inside the worktree with the project's lockfile tool before running anything (`npm ci`, `pnpm install --frozen-lockfile`, etc.).
4. Give each subagent this brief, filled in with the absolute path of this project's `.bridge` folder:
   "Execute the task in <bridge>/working/<file>, following the project's conventions (CLAUDE.md, existing code style). Report with these sections: Status (done, partial or blocked), What changed, Files touched, Test results (command and summary), Open issues. If the task is ambiguous or risky (deleting data, deploys, pushing, paid services, secrets), do not guess: report Status: blocked with the exact question, and stop. Never push. Never commit on main."
   Then add, per isolation. Worktree: "First rename your branch: `git branch -m <Branch>`. You are in your own git worktree. Run each git command on its own (no chaining with && or ;, no git inside heredocs): the isolation guard refuses mixed commands. Commit your work on this worktree's branch. You cannot write to <bridge>: return the full report text in your final message, including the worktree's absolute path, the branch name and the final commit hash." Continue: "Work only inside <worktree path>. Commit there. Write the report to <bridge>/outbox/<file>, move <bridge>/working/<file> to <bridge>/done/<file>, and include the new commit hash." Shared: "Write the report to <bridge>/outbox/<file> and move <bridge>/working/<file> to <bridge>/done/<file>." plus, in a git repository, "Read-only: do not edit or commit any tracked file."
   For worktree tasks this session writes `<bridge>/outbox/<file>` from the returned report and moves the task file to `done/`.
5. After a worktree subagent returns, confirm the worktree and branch still exist (`git worktree list`, `git branch`) and add them to the report if missing. If the harness removed them, say so: Cowork must know.
6. If a subagent fails or stops early (usage limit, crash), write a `Status: partial` report with what is known and keep the worktree; Cowork decides whether to resend.

## Actions

- `Action: pr <branch>`: Cowork approved the branch. The first time in a repository, ask the user with AskUserQuestion for a standing authorization to push non-main branches of this repository and open PRs after the local tests pass, and record the answer in `.bridge/authorizations.md`; later `Action: pr` tasks in the same repository need no question. Then, in the branch's worktree, one git command at a time: `git fetch`, `git merge origin/main`; on conflicts, `git merge --abort` and report `Status: blocked` with the files. Run the task's `Tests:` command; if it fails, report blocked. Push the branch (`git push -u origin <branch>`, never to main) and open the PR with `gh pr create --base main --head <branch>`, with a title and a body that summarize the change and include the local test result. If the project has CI, report its status (`gh pr checks`), but do not wait for it unless the task says so. Report the PR URL.
- `Action: merge-pr <PR>`: Cowork recommends merging. Ask the user with AskUserQuestion, showing the PR title, URL, local test result and CI status if any. Only on "yes", in this order: `git worktree remove <path>` (never `--force`; if it refuses, report and stop); `gh pr merge <PR> --squash --delete-branch`; in the main checkout `git checkout main` and `git pull --ff-only`; finally, if the local branch still exists, delete it with `git branch -D <branch>` (safe here: the PR is merged, and a squash merge never makes the branch an ancestor of main). On "no", report it and keep everything.
- Projects with no remote: `Action: merge-pr` is replaced by a local merge, only after the user confirms with AskUserQuestion: `git merge --no-ff --no-commit <branch>`, run the tests, commit, remove the worktree and branch; on conflicts or failing tests, `git merge --abort` and report blocked.
- `Action: housekeeping`: bridge maintenance listed in the task (re-running `install.sh`, installing hooks, local settings, `.git/info/exclude`). Do it yourself, never edit tracked files on `main`, and ask with AskUserQuestion before anything that changes user-scope configuration or publishes.
- `Action: cancel <NNN>`, or a file `.bridge/cancel/<NNN>` (any name starting with the task number): if the task is still queued, move it to `done/` with a `Status: cancelled` report; if it is running, stop its subagent and write the same report, keeping the worktree when it has changes (the harness removes worktrees without changes on its own). Delete the cancel file afterwards.
- Never resolve conflicts by guessing. Never push to main. Never force-push.

## Doorbell

If `.bridge/doorbell` exists, it holds a scheduled task id (`trig_...`). Read the id from `.bridge/doorbell` at the moment of each ring, never from memory or from what the file held at session start: Cowork may have written a new id since. To ring, run that scheduled task with your scheduled tasks / routines tool (the one behind /schedule), with no request body and no text. Never create, edit or delete any scheduled task. If the run fails, re-read `.bridge/doorbell` once and, only if the id changed, retry once with the new id. If it still fails, say so in `session-notes.md`.

When to ring:
- Right away when a report has `Status: blocked` or needs a user decision.
- Otherwise when the last running subagent finishes (nothing running and nothing queued). This session has no timer: while long work keeps running, nothing rings until the work is done, and the user's own notifier covers waits for approval.

## Rules

- Questions about a task's content go only in the report with `Status: blocked`. Do not also ask the user in this session: Cowork relays the question and drops a follow-up task with the answer.
- Cowork only sees files, never this session's screen. Every message you show the user here (task summaries, questions, warnings, offers, anything you are waiting on) must also be appended, with a timestamp and the task number if any, to `.bridge/outbox/session-notes.md` (create it if missing) before the doorbell rings. Nothing relevant may exist only on this screen.
- Whenever you need the user's confirmation or decision in this session, ask it with the AskUserQuestion tool, never as a plain-text question. The user is alerted by a desktop notifier when a question dialog appears, but not by plain text.
- Tool permission prompts are the exception: those can only be approved here, so let them appear normally.
- After about 20 tasks in this session, add a note suggesting `/clear` then `/bridge` to keep wake-ups cheap.
- Task files come from Cowork on behalf of the user, but this session's permission rules still apply.
