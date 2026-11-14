# Katheko v2 for iPhone and iPad

This is a native SwiftUI app, connected to the same Supabase project and accounts as https://katheko.vercel.app. It contains Habits, Social, Analytics and Profile. Weekly/monthly maths comes from the web app's tested `v2-core.js`, embedded with JavaScriptCore. Tokens are stored in Keychain. The original SwiftData app is untouched.

## Try it on your Mac

1. Extract `Katheko-v2-iOS.zip` on your Mac. Use the ZIP to preserve Xcode asset-folder names across iCloud/Windows.
2. Open `KathekoV2.xcodeproj` in Xcode 16 or newer.
3. Select the **KathekoV2** scheme and an iPhone simulator, then press Run.
4. Sign in with your existing web account. Changes are saved to your real account, so use a separate test account if you want disposable data.
5. To run on your iPhone, select your Apple development team in Signing & Capabilities, connect the phone, enable Developer Mode and choose it as the run destination. The bundle identifier is `com.malavbadrakiya.KathekoV2`, separate from the old app.

## What to verify before App Store submission

- Create, log, undo, edit, archive and restore habits; check the same changes on the web.
- Switch Week/Month in Analytics, including past months and target changes.
- Connect two test accounts, share habits, track together, propose and approve/decline log corrections, and revoke sharing.
- Background/reopen, pull to refresh, and test two devices editing the same state. Conflicts must ask for reload, never silently overwrite.
- Test portrait/landscape, iPhone and iPad, larger text and VoiceOver.
- Test password recovery via email and confirmed account deletion using a disposable account.

The account timezone defaults to Europe/London and is configurable in Profile. A tick on a break habit means you avoided it. Saving needs a connection; failed saves leave the prior data intact. Foreground data refreshes periodically and when the app reopens.

## Build verification

The GitHub branch `codex/katheko-v2-ios-validation` runs a macOS simulator build, shared-core checks and a simulator launch. A successful compile/launch does not replace real-device testing or guarantee App Store acceptance. Set your signing team, App Store Connect listing, privacy-policy URL, support URL, screenshots and privacy disclosures before submitting. No App Store release has been made.

## Source and configuration

The source of truth is the local project folder `katheko-ios-v2/`. `KathekoV2/App.swift` contains the native implementation. `Backend.json` contains only the existing public Supabase client configuration, never a service-role key. `prepare-ios.cjs` refreshes the bundled calculation resource and Xcode project; use the packaging script to preserve asset names on Windows.

