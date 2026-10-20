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

// Push notifications go through the Firebase project of the deployment; without its config files
// the app builds without Firebase
const googleServiceInfoPlist = process.env.GOOGLE_SERVICE_INFO_PLIST
const googleServicesJson = process.env.GOOGLE_SERVICES_JSON
const withFirebase = !!(googleServiceInfoPlist || googleServicesJson)

export default ({ config }: ConfigContext): ExpoConfig => {
  const result: ExpoConfig = {
    ...config,

    extra: {
      eas: {
        projectId: "a6335b14-fb84-45aa-ba80-6f6ab8926920",
      },
      e2eEnvProfile: process.env.EXPO_PUBLIC_E2E_ENV_PROFILE ?? null,
      e2eLanguage: process.env.EXPO_PUBLIC_E2E_LANGUAGE ?? null,
    },
    owner: "follow",

    name: "Folo",
    slug: "follow",
    version: PKG.version,
    orientation: "portrait" as const,
    icon: iconPath,
    scheme: ["follow", "folo"],
    userInterfaceStyle: "automatic" as const,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "is.follow",
      infoPlist: {
        LSApplicationCategoryType: "public.app-category.news",
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["audio"],
        LSApplicationQueriesSchemes: ["bilibili", "youtube"],
        CFBundleAllowMixedLocalizations: true,
        // apps/mobile/src/@types/constants.ts currentSupportedLanguages
        CFBundleLocalizations: ["en", "ja", "zh-CN", "zh-TW", "fr-FR"],
        CFBundleDevelopmentRegion: "en",
      },
      ...(googleServiceInfoPlist && { googleServicesFile: googleServiceInfoPlist }),
    },
    android: {
      package: "is.follow",
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
          photosPermission: "Allow $(PRODUCT_NAME) to access your photos.",
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
          // Add asset directory paths, the plugin copies the files in the given paths to the app bundle folder named Assets
          assetsPath: resolve(__dirname, "..", "..", "out", "rn-web"),
        },
      ],
      require("./plugins/with-follow-ios-resources.js"),
      require("./plugins/with-rnfb-build-properties.js"),

      require("./plugins/with-gradle-jvm-heap-size-increase.js"),
      require("./plugins/with-android-jdk-21.js"),
      require("./plugins/with-android-manifest-plugin.js"),
      require("./plugins/with-android-launch-link-guard.js"),
      "expo-secure-store",
      ...(withFirebase ? [["@react-native-firebase/app", { ios: { disableSPM: true } }]] : []),
      [
        "expo-notifications",
        {
          enableBackgroundRemoteNotifications: true,
        },
      ],
      "expo-background-task",
    ],
  }

  if (process.env.PROFILE !== "production") {
    result.plugins ||= []
    result.plugins.push(require("./plugins/android-trust-user-certs.js"))
  }

  return result
}
