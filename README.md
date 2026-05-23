# Kathēkõ Web App

This is the new web app workspace for Kathēkõ. It is currently a dependency-free local prototype so it can run immediately without a package manager or backend.

## Run Locally

From the Katheko project root:

```sh
cd katheko-webapp
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/
```

## Current Capabilities

- Single-account local demo workspace.
- 12-week seasons with unique start dates.
- Habit tracking with build/break types and weekly targets.
- Habit week navigation for reviewing previous plan weeks.
- Plan-anchored 84-day habit analytics grid.
- Stable weekly-target success rate capped at 100%.
- Loop/routine creation with timed steps.
- Habit-linked loop step creation through the step-name chooser.
- Focus sessions with timer, pause/resume, next step, complete, and abandon.
- First-minute accidental loop discard.
- Browser notification permission flow.
- Web Audio countdown beeps and transition buzzer.
- Grouped loop analytics and run history.
- Profile history across seasons.
- CSV and JSON export.
- Local knowledge notes and deterministic coaching reflections.

## Current Storage

Data is stored in browser `localStorage` under:

```text
katheko-webapp-state-v1
```

This keeps the first version fast to iterate. A production version should move the same concepts into a backend database with authentication.

## Production Direction

Recommended next stack:

- Frontend: Next.js / React
- Styling: Tailwind CSS plus a component system
- Backend: Supabase or PostgreSQL API
- Auth: Supabase Auth, Clerk, or Auth.js
- Exports: CSV first, XLSX/PDF later
- AI: OpenAI API with user-owned knowledge bases and retrieval
- Hosting: Vercel or similar

## Notes

Browser notifications and lock-screen behaviour depend on browser, operating system, PWA install state, and user permissions. The current version implements the browser-native API path; production mobile behaviour should be tested separately.
