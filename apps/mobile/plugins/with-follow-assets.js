/*
 * Builds the web app the entry WebView renders into `assetsPath` on every prebuild and bundles it
 * as the app's assets. A build left over from an older tree would not speak the app's bridge.
 *
 * This plugin is inspired by the following plugins:
 * - [expo-custom-assets](https://github.com/Malaa-tech/expo-custom-assets)
 * - [spacedrive](https://github.com/spacedriveapp/spacedrive/blob/main/apps/mobile/scripts/withRiveAssets.js)
 */

const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins")
const fs = require("node:fs")
const path = require("pathe")
const { execSync } = require("node:child_process")

const IOS_GROUP_NAME = "Assets"
const WEB_APP_DIR = path.resolve(__dirname, "..", "web-app")

let isBuilt = false

// Once per prebuild, which may run the mods of both platforms. Built directly rather than through
// a workspace filter, which EAS workers fail to resolve.
function buildWebApp(assetsPath) {
  if (isBuilt) return
  const outDir = path.join(assetsPath, "html-renderer")
  execSync(`pnpm --dir ${WEB_APP_DIR} build --outDir ${outDir} --emptyOutDir`, {
    stdio: ["ignore", "ignore", "inherit"],
  })
  isBuilt = true
}

const withFollowAssets = (config, props) => {
  const configAfterAndroid = addAndroidResources(config, props)
  return addIOSResources(configAfterAndroid, props)
}

// Code inspired by https://github.com/rive-app/rive-react-native/issues/185#issuecomment-1593396573
function addAndroidResources(config, { assetsPath }) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      buildWebApp(assetsPath)

      // Read at runtime as `file:///android_asset/FILENAME`
      const assetsDir = path.join(
        config.modRequest.projectRoot,
        "android",
        "app",
        "src",
        "main",
        "assets",
      )
      fs.mkdirSync(assetsDir, { recursive: true })
      fs.cpSync(assetsPath, assetsDir, { recursive: true })

      return config
    },
  ])
}

// Code inspired by https://github.com/expo/expo/blob/61f8cf8d4b3cf5f8bf61f346476ebdb4aff40545/packages/expo-font/plugin/src/withFontsIos.ts
function addIOSResources(config, { assetsPath }) {
  // Xcode copies the folder into the app when it builds
  const configWithBuild = withDangerousMod(config, [
    "ios",
    async (config) => {
      buildWebApp(assetsPath)
      return config
    },
  ])

  return withXcodeProject(configWithBuild, async (config) => {
    const project = config.modResults
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, IOS_GROUP_NAME)
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: path.relative(config.modRequest.platformProjectRoot, assetsPath),
      groupName: IOS_GROUP_NAME,
      project,
      isBuildFile: true,
      verbose: true,
    })
    return config
  })
}

module.exports = withFollowAssets
