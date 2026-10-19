# Development machine setup (Debian 13)

What the Android build needs, installed system-wide. Google deprecated
`sdkmanager` in favour of a new `android` CLI that ships in the same
command-line tools zip; the steps below use the new one.

## 1. JDK

    apt install openjdk-21-jdk-headless

## 2. Android SDK

The command-line tools zip ("Command line tools only" at the bottom of
https://developer.android.com/studio) is already unpacked at
`/opt/android-sdk/cmdline-tools/`. Install the SDK packages with the
`android` CLI from that directory:

    cd /opt/android-sdk/cmdline-tools/bin
    ./android --sdk=/opt/android-sdk sdk install platform-tools build-tools/36.0.0 platforms/android-36 platforms/android-37
    ./android --sdk=/opt/android-sdk sdk list

- Leave out `platforms/android-37` if it is not offered yet.
- Package names use slashes (`platforms/android-36`); the old `;` form is
  still accepted.
- Accept licences if prompted. If a Gradle build later complains about
  licences, the deprecated tool still works for that:
  `./sdkmanager --sdk_root=/opt/android-sdk --licenses`
- If you installed as root, afterwards:

      chown -R "$USER:$USER" /opt/android-sdk

  Gradle sometimes installs missing SDK pieces during a build.

Emulator, optional (for UI tests without a phone):

    ./android --sdk=/opt/android-sdk sdk install emulator system-images/android-36/default/x86_64
    adduser "$USER" kvm

The `default` image has no Google services, which matches GrapheneOS.

## 3. Environment

`/etc/profile.d/android.sh`:

    export ANDROID_HOME=/opt/android-sdk
    export PATH="$PATH:/opt/android-sdk/cmdline-tools/bin:/opt/android-sdk/platform-tools"

`~/.androidrc` (one line, so `--sdk` is not needed on every `android` call):

    --sdk=/opt/android-sdk

Gradle needs no install: the project's wrapper (`android/gradlew`) fetches
it.

## 4. Phone over USB

    apt install android-sdk-platform-tools-common

That package is only for the udev rules; use the `adb` from the SDK's
`platform-tools`. On the phone, enable USB debugging under Developer
options.

## 5. Publishing (optional)

    apt install gh
    gh auth login

Used by the release target to attach APKs to GitHub releases, which
Obtainium installs from.

## 6. Android Studio (optional)

Only if you want to open the project yourself: https://developer.android.com/studio,
pointed at `/opt/android-sdk`. Open the `android/` directory as the project,
not the repository root.

## On the phone

- Obtainium: https://github.com/ImranR98/Obtainium (also on Accrescent and
  F-Droid), pointed at this repository's GitHub releases.
- WireGuard: https://www.wireguard.com/install/

## Check

    java -version          # 21
    android info           # shows /opt/android-sdk
    adb devices            # lists the phone when plugged in
    cd ~/Git/planner/android && ./gradlew assembleDebug
