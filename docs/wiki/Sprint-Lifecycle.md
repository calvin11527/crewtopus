# Sprint Lifecycle

## Full lifecycle (story)

When you run **Full lifecycle** on a **story**:

1. **BA (analysis)** — produces requirements / plan artifacts under the work item directory  
2. **PM (planning)** — reads BA output and emits a JSON decomposition  
3. **Child tasks** — PM tasks become board **tasks** automatically (or the story is marked atomic)  
4. **Developer pipeline** — implement → test → review loop on open tasks / the story  

Tasks skip BA/PM and go straight to the developer pipeline.

## Staffing requirements

Staff these roles on the sprint team for planning to work:

- **Business Analyst**
- **Project Manager**
- **Developer** (and optionally tester / reviewer for full pipeline)

Missing BA/PM causes lifecycle to fall back to developer-only behavior.

## Autonomous mode

Sprint automation can queue work on a schedule when agents are **on shift**. Pause reasons include budget exceeded, empty queue, and off-shift hours. See the Board’s sprint team panel for status.

## Artifacts

BA/PM write under the work item output directory (inside `AGENTHUB_WORK_DIR` / `.agenthub-work`), e.g.:

- `requirements.md`
- `plan.md`
- related guide files

Inspect **Live Activity** and the work-item console for CLI stream output.
