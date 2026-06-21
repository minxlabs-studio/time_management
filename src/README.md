# `src/` modules

This folder is the target home for JavaScript logic extracted from `index.html`.

## Migration rule

Keep functions global while `index.html` still uses inline handlers such as `onclick="askAI()"`.

Do not use `type="module"` yet unless inline handlers are removed or functions are explicitly attached to `window`.

## Suggested files

- `state.js`: shared variables such as `CU`, `weekOffset`, `gCalToken`, `allCalendars`.
- `utils.js`: helpers such as `esc`, `fmtD`, `toast`, `showTab`.
- `auth.js`: Firebase login/logout and auth state.
- `tasks.js`: weekly matrix task rendering and CRUD.
- `calendar.js`: Google Calendar token, fetch, sync, and push logic.
- `goals.js`: goals, milestones, and goal-to-task logic.
- `ai-coach.js`: AI Coach frontend logic.
- `memories.js`: memory jar logic.
- `review.js`: weekly review and hour calculation.
- `app.js`: boot sequence.
