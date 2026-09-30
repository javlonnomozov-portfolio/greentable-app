---
name: android-release
description: Build, sign, install and publish the GreenTable Android APK — by default in the Expo cloud (EAS), with a local Gradle build as fallback — reusing the existing Expo login, EAS project, signing key and (for local builds) the installed JDK/SDK/NDK instead of setting anything up again. Use this whenever the user wants a new or updated APK, a GitHub release, a new app version, or the app installed on their phone as a real app (not Expo Go) — e.g. "APK yasa", "yangi versiya chiqar", "release qil", "githubga yukla", "telefonga o'rnat", "expo orqali build qil", "build the apk", "publish v1.1" — even if they don't mention EAS, Gradle, signing or SDKs.
---

# GreenTable: Android release

Two scripts hold everything slow or error-prone; run them instead of re-deriving the steps:

- `scripts/eas-build.sh` — **default** (the user chose it). Builds in the Expo cloud: nothing to install, but the free
  plan queues builds, so expect roughly 10–30 minutes.
- `scripts/build-apk.sh` — local Gradle build. Use only if the user asks for it or EAS is unavailable. The first local
  build takes ~40 minutes; later ones reuse the Gradle cache.

Both sign with **the same key** (`~/.greentable/greentable-release.jks`), so versions from either path install over
each other. Never let EAS generate or manage its own key for this app — that would make existing installs
un-updatable.

## 1. Before building a new version

A release that users install over the old app must have a **higher `android.versionCode`**; Android refuses the
update otherwise. `eas.json` uses `appVersionSource: local`, so `app.json` is the single source of truth for both paths.
For anything except rebuilding the same version:

1. In `app.json` bump `expo.version` (e.g. `1.0.0` → `1.1.0`) and `expo.android.versionCode` (+1).
2. Run the project checks: `npx tsc --noEmit`, `npx jest`, `npx expo lint`. Don't ship a failing build.
3. Commit and push, so the release tag points at the source the APK was built from.
4. Write `dist/release-notes.md` in Uzbek for the client: what's new, then how to install (download the `.apk` on the
   phone, allow "install unknown apps", install over the old version — data is kept).

## 2. Build, install, publish

From the repo root in Git Bash. Builds take many minutes, so run in the background and wait for the notification:

```bash
bash .claude/skills/android-release/scripts/eas-build.sh --install --release   # EAS → dist/greentable-<version>.apk → phone → GitHub
bash .claude/skills/android-release/scripts/eas-build.sh --id <build-id>       # resume waiting for a build already started
bash .claude/skills/android-release/scripts/build-apk.sh --check               # local: only report what's installed/missing
bash .claude/skills/android-release/scripts/build-apk.sh --install --release   # local build instead of EAS
```

`eas-build.sh` checks the Expo login, the linked EAS project and `credentials.json` (it recreates that file from
`~/.greentable/KALIT-MALUMOT.txt` if missing and refuses to continue if it isn't gitignored). It prints the build page
URL — share it with the user while they wait. `--install` needs the phone connected with USB debugging allowed.

When `--release` finishes it prints the release URL
(`https://github.com/javlonnomozov-portfolio/greentable-app/releases/tag/v<version>`). Send that link to the user.

## What is where

| Thing | Location | Notes |
|---|---|---|
| Expo account / project | `javl9n` / `@javl9n/greentable` | `projectId` is in `app.json` → `extra.eas` |
| Signing key | `~/.greentable/greentable-release.jks` + `KALIT-MALUMOT.txt` (password) | **never regenerate**; tell the user to keep a backup |
| `credentials.json` | repo root, **gitignored** | points EAS at the key above; contains the password |
| gh CLI | `~/.local/gh/bin/gh.exe` | logged in as `javlonnomozov-portfolio`; the repo has a repo-local git credential helper for it |
| Repo | `github.com/javlonnomozov-portfolio/greentable-app` (public), branch `master` | |
| CPU architectures | `armeabi-v7a`, `arm64-v8a` only | EAS: `eas.json` → `build.base.env`; local: `-PreactNativeArchitectures`. x86 is emulator-only and doubles native compile time |
| Local build: JDK 17 / SDK | `~/.jdks/jdk-17*`, `~/Android/Sdk`, cache `~/.gradle` | versions read from `node_modules/react-native/gradle/libs.versions.toml` |

`dist/` (APKs, logs, release notes) and `android/` (regenerated from `app.json`) are gitignored and must stay out of git.

## Troubleshooting

- **Expo not logged in**: `npx eas-cli login` opens the browser; run it in the background and tell the user to finish
  the login there. If it says "already logged in", don't log in again.
- **EAS build ERRORED**: open the build page URL for logs. Native config errors usually mean `app.json` changed —
  fix and rerun; nothing local needs cleaning.
- **Phone `unauthorized` in `adb devices`**: ask the user to accept "Allow USB debugging?" on the phone;
  `adb kill-server && adb start-server` makes the prompt appear again.
- **gh not logged in**: run `gh auth login --hostname github.com --git-protocol https --web` in the background, read the
  one-time code from its output and give the user the code plus `https://github.com/login/device`; after entering it
  they must also press **Authorize**.
- Local build only:
  - `LicenceNotAcceptedException` (ndk/platform): the new command-line tools no longer write licence files, so Gradle
    can't auto-download. `build-apk.sh` preinstalls with `android.exe sdk install platforms/android-36 …` (ids use `/`;
    `sdkmanager.bat` breaks on `;`).
  - `EBUSY … unlink … android/app/build`: a leftover Gradle/Kotlin daemon holds the files. The script builds with
    `--no-daemon` and in-process Kotlin to avoid it; if it still happens, stop the `java.exe` processes started from
    `~/.jdks` and rerun.
- "Open with → GreenTable" for backup files and other native features only work in the built APK, not in Expo Go.
