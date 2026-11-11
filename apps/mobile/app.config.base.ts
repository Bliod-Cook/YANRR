import type { ConfigContext, ExpoConfig } from "expo/config"
import { resolve } from "pathe"

const PKG = require("./package.json") as typeof import("./package.json")

// const roundedIconPath = resolve(__dirname, "../../resources/icon.png")
const iconPathMap = {
  production: resolve(__dirname, "./assets/icon.png"),
  development: resolve(__dirname, "./assets/icon-dev.png"),
  "ios-simulator": resolve(__dirname, "./assets/icon-dev.png"),
  preview: resolve(__dirname, "./assets/icon-staging.png"),
} as Record<string, string>
const iconPath = iconPathMap[process.env.PROFILE || "production"] || iconPathMap.production

const adaptiveIconPath = resolve(__dirname, "./assets/adaptive-icon.png")
const splashIconPath = resolve(__dirname, "./assets/splash-icon.png")

// Push notifications go through the Firebase project of the deployment; a platform without its
// config file builds without Firebase
const googleServiceInfoPlist = process.env.GOOGLE_SERVICE_INFO_PLIST
const googleServicesJson = process.env.GOOGLE_SERVICES_JSON

/**
 * The build number of both platforms. Android installs only an equal or higher one over an app, so
 * it has to grow with every version, which holds while minor and patch stay below 100.
 */
export const versionCodeOf = (version: string) => {
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number]
  if (minor >= 100 || patch >= 100) {
    throw new Error(`Version ${version} has no version code: minor and patch must stay below 100`)
  }
  return major * 10000 + minor * 100 + patch
}

const versionCode = versionCodeOf(PKG.version)

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  extra: {
    e2eLanguage: process.env.EXPO_PUBLIC_E2E_LANGUAGE ?? null,
  },

  name: "Yanrr",
  slug: "yanrr",
  version: PKG.version,
  orientation: "portrait" as const,
  icon: iconPath,
  scheme: ["yanrr"],
  userInterfaceStyle: "automatic" as const,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "io.github.bliodcook.yanrr",
    buildNumber: String(versionCode),
    infoPlist: {
      LSApplicationCategoryType: "public.app-category.news",
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ["audio"],
      LSApplicationQueriesSchemes: ["bilibili", "youtube"],
      CFBundleAllowMixedLocalizations: true,
      // apps/mobile/src/@types/constants.ts currentSupportedLanguages
      CFBundleLocalizations: ["en", "ja", "zh-CN", "zh-TW", "fr-FR"],
      CFBundleDevelopmentRegion: "en",
      // Self-hosted servers and the images of articles may be plain HTTP, on the local network as
      // well. Replaces the template's ATS settings: with NSAllowsLocalNetworking beside it, iOS
      // ignores NSAllowsArbitraryLoads.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSLocalNetworkUsageDescription:
        "$(PRODUCT_NAME) connects to your server when it is on the local network.",
    },
    ...(googleServiceInfoPlist && { googleServicesFile: googleServiceInfoPlist }),
  },
  android: {
    package: "io.github.bliodcook.yanrr",
    versionCode,
    // Media selection uses system pickers; saving only needs write access on older Android versions.
    blockedPermissions: [
      "android.permission.ACCESS_MEDIA_LOCATION",
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.RECORD_AUDIO",
      // The template's, for the development menu; debug builds keep it from their own manifest
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    adaptiveIcon: {
      foregroundImage: adaptiveIconPath,
      monochromeImage: adaptiveIconPath,
      backgroundColor: "#FF5C00",
    },
    ...(googleServicesJson && { googleServicesFile: googleServicesJson }),
  },
  // web: {
  //   bundler: "metro",
  //   output: "static",
  //   favicon: iconPath,
  // },
  plugins: [
    [
      "expo-document-picker",
      {
        iCloudContainerEnvironment: "Production",
      },
    ],
    "expo-localization",
    [
      "expo-splash-screen",
      {
        android: {
          image: splashIconPath,
          imageWidth: 200,
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "16.4",
          // Expo SDK 55 archive builds regress with use_frameworks + prebuilt RN core.
          buildReactNativeFromSource: true,
          useFrameworks: "static",
          forceStaticLinking: ["RNFBApp", "RNFBMessaging"],
          // Apps linked against the iOS 27 SDK (Xcode 27) crash at launch on iOS 27 without
          // the UIScene life cycle. Remove after upgrading to Expo SDK 58, which adopts it natively.
          enableSceneSupport: true,
        },
      },
    ],
    "expo-sqlite",
    [
      "expo-media-library",
      {
        // The app only adds images
        photosPermission: false,
        savePhotosPermission: "Allow $(PRODUCT_NAME) to save photos.",
        isAccessMediaLocationEnabled: false,
        granularPermissions: [],
      },
    ],
    "expo-status-bar",
    "expo-web-browser",
    "expo-image",
    "expo-sharing",
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      require("./plugins/with-follow-assets.js"),
      {
        // The plugin builds the web app here and copies the folder into the app bundle as Assets
        assetsPath: resolve(__dirname, "..", "..", "out", "rn-web"),
      },
    ],
    require("./plugins/with-follow-ios-resources.js"),
    require("./plugins/with-rnfb-build-properties.js"),
    require("./plugins/with-android-gradle-properties.js"),
    require("./plugins/with-android-manifest-plugin.js"),
    require("./plugins/with-android-launch-link-guard.js"),
    require("./plugins/with-android-release-signing.js"),
    require("./plugins/with-android-network-security.js"),
    // The app stores nothing behind Face ID
    ["expo-secure-store", { faceIDPermission: false }],
    ...(googleServiceInfoPlist ? [require("./plugins/with-ios-firebase.js")] : []),
    [
      "expo-notifications",
      {
        enableBackgroundRemoteNotifications: true,
      },
    ],
    "expo-background-task",
  ],
})
