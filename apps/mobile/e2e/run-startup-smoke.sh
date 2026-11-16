#!/usr/bin/env bash
set -euo pipefail
: "${APK_PATH:?Set APK_PATH to the Android APK to test}"
: "${SMOKE_OUTPUT:?Set SMOKE_OUTPUT to the test artifact directory}"
mkdir -p "$SMOKE_OUTPUT"
adb install -r "$APK_PATH"
adb logcat -c
set +e
maestro test --format junit --output "$SMOKE_OUTPUT/results.xml" --test-output-dir "$SMOKE_OUTPUT" apps/mobile/e2e/startup.yaml
smoke_status=$?
adb logcat -d -v threadtime > "$SMOKE_OUTPUT/logcat.txt"
exit "$smoke_status"
