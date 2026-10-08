#!/usr/bin/env bash
# GreenTable: imzolangan release APK yig'ish (Windows, Git Bash).
#
# Har bir qadam avval tekshiradi va faqat yetishmaganini bajaradi:
#   JDK 17, Android command-line tools, SDK platform / build-tools / NDK / CMake,
#   imzolash kaliti — bor bo'lsa qayta yuklanmaydi va qayta yaratilmaydi.
#
# Foydalanish (loyiha ildizidan):
#   bash .claude/skills/android-release/scripts/build-apk.sh [--clean] [--install] [--release] [--check]
#     --check    faqat muhitni tekshiradi (hech narsa yuklamaydi, yig'maydi)
#     --clean    android/ ni to'liq qayta yaratadi (app.json'da native sozlama o'zgarganda)
#     --install  tayyor APK'ni ulangan telefonga adb bilan o'rnatadi
#     --release  GitHub'da v<versiya> release ochadi (yoki mavjudiga APK'ni qayta yuklaydi)
set -euo pipefail

CLEAN=0 INSTALL=0 RELEASE=0 CHECK=0
for a in "$@"; do
  case "$a" in
    --clean) CLEAN=1 ;;
    --install) INSTALL=1 ;;
    --release) RELEASE=1 ;;
    --check) CHECK=1 ;;
    *) echo "Noma'lum parametr: $a" >&2; exit 2 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
W() { cygpath -m "$1"; } # Windows dasturlari uchun C:/... ko'rinishidagi yo'l
HOMEW="$(W "$HOME")"
JDK_ROOT="$HOMEW/.jdks"
SDK="${ANDROID_HOME:-$HOMEW/Android/Sdk}"
KEY_DIR="$HOMEW/.greentable"
KEYSTORE="$KEY_DIR/greentable-release.jks"
KEY_INFO="$KEY_DIR/KALIT-MALUMOT.txt"
KEY_ALIAS="greentable"
DIST="$ROOT/dist"
DL="$HOMEW/.cache/greentable-build"
ABIS="armeabi-v7a,arm64-v8a"
mkdir -p "$DIST" "$DL"

log() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
need() { printf '  ✗ %s\n' "$*"; }
unzip_to() { powershell.exe -NoProfile -Command "Expand-Archive -Path '$1' -DestinationPath '$2' -Force" >/dev/null; }

# ---------- Versiyalar: loyihaning o'zidan ----------
TOML="$ROOT/node_modules/react-native/gradle/libs.versions.toml"
[ -f "$TOML" ] || { echo "node_modules yo'q — avval: npm install" >&2; exit 1; }
tomlv() { sed -n "s/^$1 = \"\(.*\)\"/\1/p" "$TOML" | head -1; }
COMPILE_SDK="$(tomlv compileSdk)"
BUILD_TOOLS="$(tomlv buildTools)"
NDK_VER="$(tomlv ndkVersion)"
CMAKE_VER="3.22.1"
APP_VERSION="$(node -p "require('./app.json').expo.version")"
VERSION_CODE="$(node -p "require('./app.json').expo.android.versionCode")"
APK_OUT="$DIST/greentable-$APP_VERSION.apk"
echo "GreenTable $APP_VERSION (versionCode $VERSION_CODE) · SDK $COMPILE_SDK · build-tools $BUILD_TOOLS · NDK $NDK_VER"

# ---------- 1. JDK 17 ----------
log "JDK 17"
JAVA_HOME_DIR="$(ls -d "$JDK_ROOT"/jdk-17* 2>/dev/null | head -1 || true)"
if [ -n "$JAVA_HOME_DIR" ] && [ -x "$JAVA_HOME_DIR/bin/java.exe" ]; then
  ok "bor: $JAVA_HOME_DIR"
else
  need "topilmadi"
  if [ "$CHECK" = 0 ]; then
    curl -fsSL -o "$DL/jdk17.zip" "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
    mkdir -p "$JDK_ROOT" && unzip_to "$DL/jdk17.zip" "$JDK_ROOT"
    JAVA_HOME_DIR="$(ls -d "$JDK_ROOT"/jdk-17* | head -1)"
    ok "o'rnatildi: $JAVA_HOME_DIR"
  fi
fi
export JAVA_HOME="$JAVA_HOME_DIR" ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export PATH="$(cygpath -u "${JAVA_HOME:-/}")/bin:$PATH"

# ---------- 2. Android command-line tools ----------
log "Android command-line tools"
ANDROID_CLI="$SDK/cmdline-tools/latest/bin/android.exe"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"
if [ -f "$ANDROID_CLI" ] || [ -f "$SDKMANAGER" ]; then
  ok "bor: $SDK/cmdline-tools/latest"
else
  need "topilmadi"
  if [ "$CHECK" = 0 ]; then
    ZIP="$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml |
      grep -o 'commandlinetools-win-[0-9]*_latest.zip' | sort -u -t- -k3 -n | tail -1)"
    curl -fsSL -o "$DL/$ZIP" "https://dl.google.com/android/repository/$ZIP"
    rm -rf "$SDK/_tmp" && mkdir -p "$SDK/_tmp" "$SDK/cmdline-tools"
    unzip_to "$DL/$ZIP" "$SDK/_tmp"
    rm -rf "$SDK/cmdline-tools/latest" && mv "$SDK/_tmp/cmdline-tools" "$SDK/cmdline-tools/latest" && rm -rf "$SDK/_tmp"
    ok "o'rnatildi: $ZIP"
  fi
fi

# ---------- 3. SDK paketlari ----------
log "SDK paketlari"
MISSING=()
for p in "platforms/android-$COMPILE_SDK" "build-tools/$BUILD_TOOLS" "ndk/$NDK_VER" "cmake/$CMAKE_VER"; do
  if [ -d "$SDK/$p" ]; then ok "$p"; else need "$p"; MISSING+=("$p"); fi
done
if [ "${#MISSING[@]}" -gt 0 ] && [ "$CHECK" = 0 ]; then
  # Gradle bularni o'zi yuklay olmaydi: yangi command-line tools litsenziya faylini yaratmaydi,
  # Gradle esa uni talab qiladi. Shuning uchun oldindan o'rnatamiz.
  if [ -f "$ANDROID_CLI" ]; then
    "$ANDROID_CLI" --no-metrics --sdk="$SDK" sdk install "${MISSING[@]}"
  else
    # Eski sdkmanager: .bat ';' ni ajratuvchi deb tushunadi — ro'yxat fayl orqali beriladi.
    printf '%s\n' "${MISSING[@]}" | sed 's#/#;#' > "$DL/packages.txt"
    yes | "$SDKMANAGER" --sdk_root="$SDK" --package_file="$(W "$DL/packages.txt")"
  fi
fi

# ---------- 4. Imzolash kaliti ----------
log "Imzolash kaliti"
if [ -f "$KEYSTORE" ] && [ -f "$KEY_INFO" ]; then
  ok "bor: $KEYSTORE"
else
  need "topilmadi: $KEYSTORE"
  if [ "$CHECK" = 0 ]; then
    echo "  DIQQAT: yangi kalit bilan imzolangan APK eski kalitdagi ilovaning ustidan O'RNATILMAYDI."
    echo "  Agar oldin release chiqarilgan bo'lsa, kalitni zaxiradan tiklang va skriptni qayta ishga tushiring."
    read -r -p "  Baribir yangi kalit yaratilsinmi? (ha/yo'q) " ans
    [ "$ans" = "ha" ] || exit 1
    mkdir -p "$KEY_DIR"
    PW="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
    "$JAVA_HOME/bin/keytool.exe" -genkeypair -keystore "$KEYSTORE" -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 \
      -validity 10000 -storepass "$PW" -keypass "$PW" -dname "CN=GreenTable, O=GreenTable, C=UZ" >/dev/null
    printf 'GreenTable Android imzolash kaliti\n\nFayl: greentable-release.jks\nAlias: %s\nParol (store va key): %s\n\nBU FAYLNI VA PAROLNI YOQOTMANG — nusxasini xavfsiz joyda saqlang.\n' "$KEY_ALIAS" "$PW" > "$KEY_INFO"
    ok "yaratildi — $KEY_DIR papkasini zaxiralang!"
  fi
fi

if [ "$CHECK" = 1 ]; then
  log "Tekshiruv tugadi (--check): yig'ilmadi"
  exit 0
fi

# ---------- 5. Android loyihasi (prebuild) ----------
# android/ faqat native sozlama o'zgarganda qayta yaratiladi: app.json, bog'liqliklar yoki ikonkalar.
# Aks holda o'tkazib yuboriladi — Gradle keshi va kompilyatsiya qilingan C++ saqlanib qoladi.
log "expo prebuild"
STAMP="$( { cat app.json; node -p "JSON.stringify(require('./package.json').dependencies)"; sha1sum assets/*.png; } | sha1sum | cut -d' ' -f1)"
STAMP_FILE="$ROOT/android/.greentable-prebuild"
if [ "$CLEAN" = 1 ] || [ ! -d android ] || [ "$(cat "$STAMP_FILE" 2>/dev/null)" != "$STAMP" ]; then
  # Oldingi yig'ishdan qolgan Gradle daemon android/app/build fayllarini band qilib turadi (EBUSY).
  if [ -x android/gradlew ]; then (cd android && ./gradlew --stop >/dev/null 2>&1) || true; fi
  # prebuild package.json'dagi android/ios skriptlarini "expo run:*" ga almashtiradi — xato bo'lsa ham qaytaramiz.
  cp package.json "$DL/package.json.bak"
  trap 'cp "$DL/package.json.bak" "$ROOT/package.json"' EXIT
  CI=1 npx expo prebuild --platform android --no-install $([ "$CLEAN" = 1 ] && echo --clean) >/dev/null
  cp "$DL/package.json.bak" package.json
  trap - EXIT
  echo "$STAMP" > "$STAMP_FILE"
  ok "android/ yangilandi$([ "$CLEAN" = 1 ] && echo ' (--clean)')"
else
  ok "native sozlama o'zgarmagan — o'tkazib yuborildi"
fi

# ---------- 6. Gradle ----------
log "Gradle assembleRelease (birinchi marta 20-40 daq, keyin bir necha daqiqa)"
GRADLE_LOG="$DIST/gradle-build.log"
START=$(date +%s)
(
  cd android
  # --no-daemon va in-process Kotlin: yig'ishdan keyin xotirada Java jarayoni qolmaydi. Aks holda ular
  # android/app/build fayllarini band qilib turadi va keyingi prebuild EBUSY bilan yiqiladi.
  NODE_ENV=production ./gradlew assembleRelease -PreactNativeArchitectures="$ABIS" \
    -Pkotlin.compiler.execution.strategy=in-process --no-daemon \
    "-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m" --console=plain
) > "$GRADLE_LOG" 2>&1 || { tail -40 "$GRADLE_LOG"; echo "Gradle xatosi — to'liq log: $GRADLE_LOG" >&2; exit 1; }
ok "tayyor: $(( ($(date +%s) - START) / 60 )) daq (log: $GRADLE_LOG)"

# ---------- 7. Imzolash ----------
log "Imzolash (apksigner)"
UNSIGNED="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
APKSIGNER="$SDK/build-tools/$BUILD_TOOLS/apksigner.bat"
GREENTABLE_KS_PASS="$(sed -n 's/^Parol (store va key): //p' "$KEY_INFO" | tr -d '\r')"
export GREENTABLE_KS_PASS
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass env:GREENTABLE_KS_PASS --key-pass env:GREENTABLE_KS_PASS \
  --out "$(W "$APK_OUT")" "$(W "$UNSIGNED")"
"$APKSIGNER" verify --print-certs "$(W "$APK_OUT")" | grep -m1 "certificate SHA-256" || true
ok "$APK_OUT ($(du -h "$APK_OUT" | cut -f1))"

# ---------- 8. Telefonga o'rnatish ----------
if [ "$INSTALL" = 1 ]; then
  log "Telefonga o'rnatish"
  if adb get-state >/dev/null 2>&1; then
    adb install -r "$(W "$APK_OUT")" && ok "o'rnatildi"
  else
    need "telefon ulanmagan yoki USB-debug ruxsati berilmagan (adb devices)"
  fi
fi

# ---------- 9. GitHub release ----------
if [ "$RELEASE" = 1 ]; then
  log "GitHub release v$APP_VERSION"
  GH="$(command -v gh || echo "$HOMEW/.local/gh/bin/gh.exe")"
  "$GH" auth status >/dev/null 2>&1 || { echo "gh login qilinmagan: $GH auth login --web" >&2; exit 1; }
  # Doimiy nom: bot va qo'llanmadagi havola .../releases/latest/download/greentable.apk har doim oxirgi versiyani beradi.
  STABLE="$DIST/greentable.apk"
  cp "$APK_OUT" "$STABLE"
  if "$GH" release view "v$APP_VERSION" >/dev/null 2>&1; then
    "$GH" release upload "v$APP_VERSION" "$(W "$STABLE")" --clobber
    ok "mavjud release'ga APK qayta yuklandi"
  else
    NOTES="$DIST/release-notes.md"
    [ -f "$NOTES" ] || printf "GreenTable %s\n\nO'rnatish: greentable.apk faylini telefonga yuklab oching.\n" "$APP_VERSION" > "$NOTES"
    "$GH" release create "v$APP_VERSION" "$(W "$STABLE")" --title "GreenTable $APP_VERSION" --notes-file "$(W "$NOTES")" --latest
  fi
  "$GH" release view "v$APP_VERSION" --json url -q .url
fi
