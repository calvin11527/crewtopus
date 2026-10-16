# Case study: one crew pass on Crewtopus

Non-toy repo: [calvin11527/crewtopus](https://github.com/calvin11527/crewtopus). This is the product’s own sprint board, not a sample app.

## Project

- **Repo / product:** Crewtopus — local multi-agent sprint crew
- **Story:** A task stayed in the harness because every card repeated implement → test → review up to three times before a person could step in
- **Goal:** Finish or stop after one crew pass, and let the person ask for more

## Crew setup

| Role | Adapter | Model |
|------|---------|-------|
| Developer | Grok, or Mock for the demo | whatever is configured on Agents |
| Tester | Copilot, or Mock | same |
| Reviewer | Copilot, or Mock | same |

The dashboard button **Run mock demo on board** uses Mock only, so the first story does not need a paid CLI.

## What happened

1. The Grok → Copilot workflow template was created with `maxIterations: 3`. Shift start, full lifecycle, and the story queue passed that same cap into every job.
2. When review asked for changes, or a harness eval failed, the card ran the whole pass again. Two extra cycles is why a single task felt stuck.
3. The default is now **one** automatic pass. The work item keeps that number. A person can set **Automatic passes** to 2 or 3 on the card or in the edit dialog. The API clamps anything higher to 3.
4. Existing cards that still had the old default of 3 are reset once, on database version 12. A later choice of 3 stays 3.
5. If the adapter CLI is missing, the job error names it and says to open **Agents** and switch the role. Mock needs no paid CLI.

## What only a process gave us

1. One place that decides how many times the crew repeats, instead of a hard-coded 3 in the scheduler, the lifecycle, and the queue.
2. A stop after the first pass, so review feedback is waiting for a person instead of being fed straight back into another long run.
3. A written sprint report from **Board → Report** when you want to share what the crew actually did.

## Artifacts

- Board → **Report** downloads the sprint write-up
- This note is the public write-up for the one-pass change

## Quote

> One agent is a tool. A crew is a process — and the process should stop when the person is ready to look.
