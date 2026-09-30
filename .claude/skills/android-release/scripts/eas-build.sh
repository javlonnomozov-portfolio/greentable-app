#!/usr/bin/env bash
# GreenTable: APK'ni EAS (Expo bulutida) yig'ish — kompyuterga hech narsa o'rnatilmaydi.
#
# Mahalliy yig'ish bilan bir xil imzolash kaliti ishlatiladi (credentials.json → ~/.greentable),
# shuning uchun ikkala usulda chiqarilgan versiyalar bir-birining ustidan o'rnatiladi.
#
# Foydalanish (loyiha ildizidan):
#   bash .claude/skills/android-release/scripts/eas-build.sh [--install] [--release] [--id <build-id>]
#     --install     yuklab olingan APK'ni ulangan telefonga adb bilan o'rnatadi
#     --release     GitHub'da v<versiya> release ochadi (yoki mavjudiga APK'ni qayta yuklaydi)
#     --id <id>     yangi build boshlamay, mavjud build'ni kutib yuklab oladi (masalan uzilgan sessiyadan keyin)
set -euo pipefail

INSTALL=0 RELEASE=0 BUILD_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --install) INSTALL=1 ;;
    --release) RELEASE=1 ;;
    --id) BUILD_ID="$2"; shift ;;
    *) echo "Noma'lum parametr: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
W() { cygpath -m "$1"; }
HOMEW="$(W "$HOME")"
KEY_INFO="$HOMEW/.greentable/KALIT-MALUMOT.txt"
KEYSTORE="$HOMEW/.greentable/greentable-release.jks"
DIST="$ROOT/dist"
EAS="npx --yes eas-cli@latest"
mkdir -p "$DIST"

log() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

APP_VERSION="$(node -p "require('./app.json').expo.version")"
VERSION_CODE="$(node -p "require('./app.json').expo.android.versionCode")"
APK_OUT="$DIST/greentable-$APP_VERSION.apk"
echo "GreenTable $APP_VERSION (versionCode $VERSION_CODE)"

# ---------- Tekshiruvlar ----------
log "Tekshiruvlar"
ACCOUNT="$($EAS whoami 2>/dev/null | head -1 || true)"
[ -n "$ACCOUNT" ] && [ "$ACCOUNT" != "Not logged in" ] || fail "Expo'ga kirilmagan: $EAS login (brauzer ochiladi)"
ok "Expo akkaunt: $ACCOUNT"
node -e "process.exit(require('./app.json').expo.extra?.eas?.projectId ? 0 : 1)" ||
  fail "EAS loyiha ulanmagan: $EAS init --non-interactive --force"
ok "EAS loyiha: $(node -p "require('./app.json').expo.extra.eas.projectId")"

# credentials.json gitignore'da, shuning uchun boshqa klonda bo'lmasligi mumkin — kalit ma'lumotidan tiklanadi.
if [ ! -f credentials.json ]; then
  [ -f "$KEYSTORE" ] && [ -f "$KEY_INFO" ] || fail "Imzolash kaliti topilmadi: $KEYSTORE (zaxiradan tiklang)"
  PW="$(sed -n 's/^Parol (store va key): //p' "$KEY_INFO" | tr -d '\r')"
  REL="$(node -e "console.log(require('path').relative(process.argv[1], process.argv[2]).split(require('path').sep).join('/'))" "$(W "$ROOT")" "$KEYSTORE")"
  node -e "require('fs').writeFileSync('credentials.json', JSON.stringify({android:{keystore:{keystorePath:process.argv[1],keystorePassword:process.argv[2],keyAlias:'greentable',keyPassword:process.argv[2]}}},null,2)+'\n')" "$REL" "$PW"
  ok "credentials.json kalit ma'lumotidan tiklandi"
fi
git check-ignore -q credentials.json || fail "credentials.json .gitignore'da emas — parol GitHub'ga tushib qolmasin!"
ok "credentials.json (gitignore'da)"

# ---------- Build ----------
if [ -z "$BUILD_ID" ]; then
  log "EAS build boshlanmoqda (preview → APK)"
  OUT="$($EAS build -p android --profile preview --non-interactive --no-wait --json 2>/dev/null)"
  BUILD_ID="$(printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((Array.isArray(b)?b[0]:b).id)})")"
fi
PAGE="https://expo.dev/accounts/${ACCOUNT}/projects/$(node -p "require('./app.json').expo.slug")/builds/$BUILD_ID"
ok "build: $PAGE"

log "Build tugashini kutish (bepul tarifda navbat + ~10-15 daq)"
LAST=""
while :; do
  STATE="$($EAS build:view "$BUILD_ID" --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const b=JSON.parse(s);console.log(b.status+' '+(b.artifacts?.buildUrl||''))}catch{console.log('UNKNOWN')}})")"
  STATUS="${STATE%% *}"
  [ "$STATUS" != "$LAST" ] && printf '  %s  %s\n' "$(date +%H:%M)" "$STATUS" && LAST="$STATUS"
  case "$STATUS" in
    FINISHED) URL="${STATE#* }"; break ;;
    ERRORED | CANCELED) fail "build $STATUS — loglar: $PAGE" ;;
  esac
  sleep 60
done

log "APK'ni yuklab olish"
curl -fsSL -o "$APK_OUT" "$URL"
ok "$APK_OUT ($(du -h "$APK_OUT" | cut -f1))"
# Kalit to'g'riligini tekshirish (build-tools o'rnatilgan bo'lsa).
APKSIGNER="$(ls "$HOMEW"/Android/Sdk/build-tools/*/apksigner.bat 2>/dev/null | tail -1 || true)"
if [ -n "$APKSIGNER" ]; then
  "$APKSIGNER" verify --print-certs "$(W "$APK_OUT")" | grep -m1 "certificate SHA-256" || true
fi

# ---------- Telefonga o'rnatish ----------
if [ "$INSTALL" = 1 ]; then
  log "Telefonga o'rnatish"
  if adb get-state >/dev/null 2>&1; then
    adb install -r "$(W "$APK_OUT")" && ok "o'rnatildi"
  else
    printf '  ✗ telefon ulanmagan yoki USB-debug ruxsati berilmagan (adb devices)\n'
  fi
fi

# ---------- GitHub release ----------
if [ "$RELEASE" = 1 ]; then
  log "GitHub release v$APP_VERSION"
  GH="$(command -v gh || echo "$HOMEW/.local/gh/bin/gh.exe")"
  "$GH" auth status >/dev/null 2>&1 || fail "gh login qilinmagan: $GH auth login --web"
  if "$GH" release view "v$APP_VERSION" >/dev/null 2>&1; then
    "$GH" release upload "v$APP_VERSION" "$(W "$APK_OUT")" --clobber
    ok "mavjud release'ga APK qayta yuklandi"
  else
    NOTES="$DIST/release-notes.md"
    [ -f "$NOTES" ] || printf "GreenTable %s\n\nO'rnatish: greentable-%s.apk faylini telefonga yuklab oching.\n" "$APP_VERSION" "$APP_VERSION" > "$NOTES"
    "$GH" release create "v$APP_VERSION" "$(W "$APK_OUT")" --title "GreenTable $APP_VERSION" --notes-file "$(W "$NOTES")"
  fi
  "$GH" release view "v$APP_VERSION" --json url -q .url
fi
