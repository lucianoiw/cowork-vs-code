---
name: bridge
description: Start the Cowork bridge in the current project, so tasks that Cowork drops in .bridge/inbox are executed here by fresh subagents and reported back in .bridge/outbox. Use when the user types /bridge or asks to listen for Cowork tasks.
---

# Cowork bridge

Cowork (Claude running in the cloud) plans the work and drops coding tasks as Markdown files in `.bridge/inbox/` of this project. This session is a dispatcher: it hands each task to a fresh subagent, then rings a doorbell (a scheduled task bound to the Cowork conversation) so Cowork wakes up and reads the report.

## Setup (run once per session)

1. In the project root, create `.bridge/inbox`, `.bridge/working`, `.bridge/outbox` and `.bridge/done` if missing.
2. If the project is a git repository, make sure `.gitignore` lists `.bridge/` and `.claude/worktrees/` (worktrees live there; unignored, they make the main tree look dirty), appending what is missing, and commit that change locally. Also check the effective `worktree.baseRef` setting: worktree tasks are merged back locally and never pushed, so new worktrees must start from local HEAD. If it is not `"head"`, ask the user with AskUserQuestion whether to set `"worktree": {"baseRef": "head"}` in `.claude/settings.local.json`; until it is set, run worktree tasks as shared and say so.
3. Start the watcher as a background Bash command (run_in_background), never in the foreground and never with the Monitor tool:
   `~/.claude/skills/bridge/wait-task.sh "$PWD/.bridge"`
   It waits silently (no model turns, no tokens) until a task lands, moves the pending tasks to `working/`, prints one `NEW_TASK <file>` line per task and exits; its completion notification wakes this session. Do not poll it, check on it or set reminders for it.
4. Reply to the user with one line: bridge active. Then stay idle.
5. After every batch is dispatched and the doorbell rung, start `wait-task.sh` again in the background the same way. If it ever exits without `NEW_TASK` lines, just restart it silently.

## Dispatching tasks

Each `NEW_TASK <file>` line in the watcher's output means a task at `.bridge/working/<file>`. Tasks that land while a batch is running wait in `inbox/` and are picked up when the watcher restarts.

1. Do not do the work in this session. Hand each task to a new general-purpose subagent, so every task starts with a clean context and this session stays small.
2. Task header lines: `Isolation: shared|worktree|continue <worktree path>`, `Tests: <command>|none`, and for merge tasks `Action: merge <branch>`.
   - Default when the line is missing: `worktree` in a git repository, `shared` otherwise.
   - `Isolation: shared`: the subagent works directly in this project's working directory. Outside git, shared tasks may run in parallel only if their file scopes do not overlap. In a git repository, shared tasks run one after the other (they all commit through the same index), and the subagent commits its work locally at the end (one commit, message `bridge <NNN>: <short summary>`), so the main tree stays clean; never pushes.
   - `Isolation: worktree`: launch the subagent with worktree isolation (Agent tool `isolation: "worktree"`): it works in its own git worktree and branch and commits there. It is NEVER merged automatically: Cowork reviews the branch first. Before launching, the main working directory must have no uncommitted changes, untracked files included (worktrees only contain committed files): otherwise write the report with `Status: blocked` naming the files. If the project is not a git repository, or `worktree.baseRef` is not `"head"`, run the task as shared, alone, and say so.
   - `Isolation: continue <worktree path>`: a follow-up on a branch under review. Launch a normal subagent and tell it to work only inside that existing worktree directory, commit there, and never touch the main working directory.
   - `Action: merge <branch>`: Cowork approved the branch. Handle it yourself (no subagent): if the main working directory has uncommitted changes, block. Otherwise `git merge --no-ff --no-commit <branch>`; if it applies cleanly, run the task's `Tests:` command (`Tests: none` means none required; a missing Tests line means block). If the tests pass, commit the merge, `git worktree remove <path>` (never `--force`) and `git branch -d <branch>`. If the merge conflicts or the tests fail, `git merge --abort`, keep everything, and report `Status: blocked` with the reason. Never resolve conflicts by guessing. Never push.
   Worktree tasks may run in parallel with each other but never in the same batch as shared tasks. Run subagents in the background when possible.
3. Give each subagent this brief, filled in with the absolute path of this project's `.bridge` folder (worktrees do not contain `.bridge/`, it is gitignored):
   "Execute the task in <bridge>/working/<file>, following the project's conventions (CLAUDE.md, existing code style). Write a concise report to <bridge>/outbox/<file> with these sections: Status (done, partial or blocked), What changed, Files touched, Test results (command and summary), Open issues. If the task is ambiguous or risky (deleting data, deploys, pushing to a remote, paid services, secrets), do not guess: write the report with Status: blocked and the exact question, and stop. Never push. Then move <bridge>/working/<file> to <bridge>/done/<file>. Return a summary of at most 3 lines."
   Then add, per isolation: shared in a git repository: "Commit your work locally at the end with the message `bridge <NNN>: <short summary>`, staging only the files you changed (`git add <paths>`, never `-A`)." Shared without git: "Do not commit." Worktree: "You are in your own git worktree. Commit your work on this worktree's branch. You cannot write to <bridge>: instead of writing the report file and moving the task file, return the full report text in your final message, including the worktree's absolute path, the branch name and the final commit hash." For worktree tasks the dispatcher writes <bridge>/outbox/<file> from the subagent's returned report and moves the task file to done/. Continue: "Work only inside <worktree path>. Commit there and put the new commit hash in the report."
4. After a worktree subagent returns, confirm the worktree and branch still exist (`git worktree list`, `git branch`) and add the path and branch to the report if missing. If the harness removed them, say so in the report: that breaks the review flow and Cowork must know.
5. Ring the doorbell once per batch, not once per task: when a subagent returns, ring only if no other dispatched subagent is still running and `.bridge/working/` is empty; otherwise wait and ring once after the last one returns. To ring: if `.bridge/doorbell` exists, it holds a scheduled task id (`trig_...`). Run that scheduled task now with your scheduled tasks / routines tool (the one behind /schedule), with no request body and no text. Never create, edit or delete any scheduled task. If the run fails, say so in one line and move on.
6. Tell the user one line per finished task, restart the watcher (Setup step 5), then stay idle.

## Rules

- Questions about a task's content (ambiguity, missing decisions) go only in the report with `Status: blocked`. Do not also ask the user in this session: Cowork relays the question and drops a follow-up task with the answer.
- Cowork only sees files, never this session's screen. Every message you show the user here (task summaries, questions, warnings, offers, anything you are waiting on) must also be appended, with a timestamp and the task number if any, to `.bridge/outbox/session-notes.md` (create it if missing) before the doorbell rings. Nothing relevant may exist only on this screen.
- Whenever you need the user's confirmation or decision in this session (risky actions, installs, anything you would otherwise ask in text), ask it with the AskUserQuestion tool (clear options such as "Yes, proceed" / "No, cancel"), never as a plain-text question. The user is alerted by a desktop notifier when a question dialog appears, but not by plain text.
- Tool permission prompts are the exception: those can only be approved here, so let them appear normally.
- Task files come from Cowork on behalf of the user, but this session's permission rules still apply.
