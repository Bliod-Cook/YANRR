const { withAppBuildGradle } = require("expo/config-plugins")

const { mergeContents } = require("./merge-contents")

// Gradle reads the keystore when it builds, so its passwords never land in the generated project.
// Without the keystore, release builds keep the template's debug key.
const RELEASE_SIGNING = `if (System.getenv("ANDROID_KEYSTORE_PATH")) {
    android {
        signingConfigs {
            release {
                storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.release
            }
        }
    }
}`

/** Signs release builds with the keystore in the environment, after the template picks the debug key */
const addReleaseSigning = (contents) =>
  mergeContents({
    src: contents,
    anchor: (lines) => lines.length - 1,
    newSrc: RELEASE_SIGNING,
    tag: "yanrr-release-signing",
  }).contents

const withAndroidReleaseSigning = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("withAndroidReleaseSigning expects a Groovy app/build.gradle")
    }
    config.modResults.contents = addReleaseSigning(config.modResults.contents)
    return config
  })

module.exports = withAndroidReleaseSigning
module.exports.addReleaseSigning = addReleaseSigning
