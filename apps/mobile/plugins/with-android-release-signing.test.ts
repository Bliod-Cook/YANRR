import { createRequire } from "node:module"

import { describe, expect, it } from "vitest"

const { addReleaseSigning } = createRequire(import.meta.url)(
  "./with-android-release-signing.js",
) as { addReleaseSigning: (contents: string) => string }

// The signing part of Expo's app/build.gradle template, which signs release builds with the debug key
const BUILD_GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`

describe("addReleaseSigning", () => {
  it("signs release builds with the keystore in the environment when there is one", () => {
    const contents = addReleaseSigning(BUILD_GRADLE)
    const signing = contents.slice(contents.indexOf('if (System.getenv("ANDROID_KEYSTORE_PATH"))'))

    // After the template, so it overrides the debug key
    expect(contents.indexOf("dependencies {")).toBeLessThan(contents.indexOf(signing))
    expect(signing).toContain('storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))')
    expect(signing).toContain('storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")')
    expect(signing).toContain('keyAlias System.getenv("ANDROID_KEY_ALIAS")')
    expect(signing).toContain('keyPassword System.getenv("ANDROID_KEY_PASSWORD")')
    expect(signing).toContain("signingConfig signingConfigs.release")
  })

  it("adds the signing once however often prebuild runs", () => {
    const once = addReleaseSigning(BUILD_GRADLE)

    expect(addReleaseSigning(once)).toBe(once)
  })
})
