# Katheko v2

Vanilla JavaScript web app using Supabase Auth and user_state. Four routes: Habits, Social, Analytics, Profile.

## Local review

Serve this folder with a static HTTP server. Open preview-v2.html for an isolated sample-data preview, or index.html for Supabase authentication. The latter requires the reviewed v2 SQL migration before saving or using Social.

## Tests

`node --test v2-core.test.cjs v2-runtime.test.cjs`

## Release

Production release authorised on 14 November 2026. Existing Supabase accounts and saved records are retained. V1 code is backed up outside this public repository at `archive/Katheko First Web App Draft/`; a private database snapshot preserves original state, profiles, friendships and XP.

V2 uses revision-aware save RPCs and permission-checked social RPCs. Legacy direct writes are disabled at cutover. Account dates default to Europe/London and can be changed in Profile. Weeks start Monday; monthly targets are proportional to eligible days. Habit points are ten per completed day plus thirty per weekly target.

Validation: 15 Node checks, transactional three-account database permission tests, real HTTP authentication and social tests with disposable accounts (removed), and responsive browser checks. Cache v45. Native iOS uses the same backend and calculation source; its source and build notes live in the project’s `katheko-ios-v2/` folder.
