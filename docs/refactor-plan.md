# Refactor plan: split the single-file app

This repo currently keeps most UI, CSS, and JavaScript inside `index.html`. That makes small updates risky because unrelated features can break when editing one large file.

## Target structure

```txt
time_management/
├─ index.html
├─ api/
│  └─ ai-coach.js
├─ src/
│  ├─ state.js
│  ├─ utils.js
│  ├─ auth.js
│  ├─ tasks.js
│  ├─ calendar.js
│  ├─ goals.js
│  ├─ ai-coach.js
│  ├─ memories.js
│  ├─ review.js
│  └─ app.js
├─ styles/
│  ├─ base.css
│  ├─ layout.css
│  ├─ tasks.css
│  ├─ calendar.css
│  ├─ goals.css
│  ├─ ai-coach.css
│  ├─ memories.css
│  └─ review.css
└─ docs/
   └─ refactor-plan.md
```

## Safe migration order

1. Move CSS first. This is the lowest-risk change.
2. Move AI Coach JavaScript next, because it changes often and already has a backend API route.
3. Move Tasks, Goals, Calendar, Memories, and Review one by one.
4. Keep functions global at first because `index.html` still uses inline handlers like `onclick="askAI()"`.
5. Only switch to ES modules later after inline handlers are removed.

## Rule for each step

Each feature should be moved in a separate commit so bugs can be reverted easily.

Example commit sequence:

```bash
git commit -m "Move AI Coach logic to src"
git commit -m "Move task logic to src"
git commit -m "Move calendar logic to src"
git commit -m "Move styles to CSS files"
```

## Important note

Do not delete code from `index.html` until the extracted file has been linked and tested on Vercel.
