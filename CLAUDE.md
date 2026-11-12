# CLAUDE.md

## About the user
- The user is a physics student in CMU 02-120 Programming for Scientists.

## Project goal
- The project requirements are outlined in `Project_Description_F26.pdf`.
- The aim is a Claude-assisted project that creates a visual display on a webpage.
- The project proposal is in `proposal.md` (symlinked to `Proposal.md`). Read it for the specific subject matter and scope.

## Working rules
1. **Verifiable code.** Write code the user can verify themselves: keep it clear and simple, explain what it does, and include ways to check correctness (for example, comparison against known or analytical results, sanity checks, or tests). Avoid opaque or overly clever code.
2. **Ask before acting.** Do not do anything without consulting the user and getting their explicit approval first. This covers creating, editing, or deleting files, running commands, installing packages, and making git commits. Propose the plan, then wait for approval.
3. **Understand project on startup.** This involves looking at the project requirements in `Project_Description_F26.pdf`, looking at the proposal in `proposal.md`, and looking at the code to see the structure.
4. **Always consult the programmer.** When making high-level technical decisions and implementation choices, always ask the programmer to make the choice.
5. **Keep the Learning tab in step with the assumptions.** Whenever a modelling assumption is added or changed (README assumptions table A1, A2, ...), also update the Learning tab (`<div id="learn">` in `web/index.html`): the Limitations entry (what is simplified, why, and its effect), and any equation or worked example the change affects. If a worked-example number changes, update its `data-check` value and run `tests/test_learning.py`.
