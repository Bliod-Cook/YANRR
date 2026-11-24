import { execFileSync } from "node:child_process"
import fs, { readdirSync } from "node:fs"
import { cp, readdir } from "node:fs/promises"

import { FuseV1Options, FuseVersion } from "@electron/fuses"
import { MakerDeb } from "@electron-forge/maker-deb"
import { MakerDMG } from "@electron-forge/maker-dmg"
import { MakerSquirrel } from "@electron-forge/maker-squirrel"
import { FusesPlugin } from "@electron-forge/plugin-fuses"
import type { ForgeConfig } from "@electron-forge/shared-types"
import MakerAppImage from "electron-forge-maker-appimage"
import setLanguages from "electron-packager-languages"
import path, { resolve } from "pathe"
import { rimraf, rimrafSync } from "rimraf"

const mode = process.argv.find((arg) => arg.startsWith("--mode"))?.split("=")[1]

const isStaging = mode === "staging"

class YanrrAppImageMaker extends MakerAppImage {
  override getBuildOptions(options: Parameters<MakerAppImage["getBuildOptions"]>[0]) {
    // The release workflow publishes Forge artifacts.
    return { ...super.getBuildOptions(options), publish: "never" as const }
  }

  protected override getTarget(targetArch: string, config: MakerAppImage["config"]) {
    const target = super.getTarget(targetArch, config)
    return {
      ...target,
      config: {
        ...target.config,
        linux: { icon: isStaging ? "resources/icon-staging.png" : "resources/icon.png" },
      },
    }
  }
}

const artifactRegex = /.*\.(?:exe|dmg|AppImage|deb)$/
const platformNamesMap = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
}

// The modules the main process loads at runtime instead of bundling them, kept in app.asar.
// Neither has dependencies of its own.
const keepModules = new Set(["font-list", "vscode-languagedetection"])
const keepLanguages = new Set(["en", "en_GB", "en-US", "en_US"])

// remove folders & files not to be included in the app
async function cleanSources(buildPath, _electronVersion, platform, _arch, callback) {
  // folders & files to be included in the app
  const appItems = new Set(["dist", "node_modules", "package.json", "resources"])

  if (platform === "darwin") {
    const frameworkResourcePath = resolve(
      buildPath,
      "../../Frameworks/Electron Framework.framework/Versions/A/Resources",
    )

    for (const file of readdirSync(frameworkResourcePath)) {
      if (file.endsWith(".lproj") && !keepLanguages.has(file.split(".")[0]!)) {
        rimrafSync(resolve(frameworkResourcePath, file))
      }
    }
  }

  // Keep only node_modules to be included in the app

  await Promise.all([
    ...(await readdir(buildPath).then((items) =>
      items.filter((item) => !appItems.has(item)).map((item) => rimraf(path.join(buildPath, item))),
    )),
    ...(await readdir(path.join(buildPath, "node_modules")).then((items) =>
      items
        .filter((item) => !keepModules.has(item))
        .map((item) => rimraf(path.join(buildPath, "node_modules", item))),
    )),
  ])

  // copy needed node_modules to be included in the app
  await Promise.all(
    Array.from(keepModules.values()).map((item) => {
      // Check is exist
      if (fs.existsSync(path.join(buildPath, "node_modules", item))) {
        // eslint-disable-next-line array-callback-return
        return
      }
      return cp(
        path.join(process.cwd(), "../../node_modules", item),
        path.join(buildPath, "node_modules", item),
        {
          recursive: true,
        },
      )
    }),
  )

  callback()
}

const noopAfterCopy = (_buildPath, _electronVersion, _platform, _arch, callback) => callback()

const keepModulePattern = [...keepModules]
  .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|")
const ignorePattern = new RegExp(`^/node_modules/(?!(?:${keepModulePattern})(?:/|$))`)

const config: ForgeConfig = {
  packagerConfig: {
    name: isStaging ? "Yanrr Staging" : "Yanrr",
    appCategoryType: "public.app-category.news",
    buildVersion: process.env.BUILD_VERSION || undefined,
    appBundleId: "io.github.bliodcook.yanrr",
    icon: isStaging ? "resources/icon-staging" : "resources/icon",
    protocols: [
      {
        name: "Yanrr",
        schemes: ["yanrr"],
      },
    ],

    afterCopy: [
      cleanSources,
      process.platform !== "win32" ? noopAfterCopy : setLanguages([...keepLanguages.values()]),
    ],
    asar: true,
    ignore: [ignorePattern],

    prune: false,
    extendInfo: {
      ITSAppUsesNonExemptEncryption: false,
    },
    // Without an identity the postPackage hook signs the app ad hoc instead
    ...(process.env.OSX_SIGN_IDENTITY && {
      osxSign: {
        optionsForFile: () => ({
          entitlements: "build/entitlements.mac.plist",
        }),
        keychain: process.env.OSX_SIGN_KEYCHAIN_PATH,
        identity: process.env.OSX_SIGN_IDENTITY,
        provisioningProfile: process.env.OSX_SIGN_PROVISIONING_PROFILE_PATH,
      },
    }),
    ...(process.env.APPLE_ID &&
      process.env.APPLE_PASSWORD &&
      process.env.APPLE_TEAM_ID && {
        osxNotarize: {
          appleId: process.env.APPLE_ID!,
          appleIdPassword: process.env.APPLE_PASSWORD!,
          teamId: process.env.APPLE_TEAM_ID!,
        },
      }),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG(
      {
        overwrite: true,
        background: "static/dmg-background.png",
        icon: "static/dmg-icon.icns",
        iconSize: 160,
        additionalDMGOptions: {
          window: {
            size: {
              width: 660,
              height: 400,
            },
          },
        },
        contents: (opts) => [
          {
            x: 180,
            y: 170,
            type: "file",
            path: (opts as any).appPath,
          },
          {
            x: 480,
            y: 170,
            type: "link",
            path: "/Applications",
          },
        ],
      },
      ["darwin"],
    ),
    new YanrrAppImageMaker({
      category: "Utility",
      mimeTypes: ["x-scheme-handler/yanrr"],
    }),
    new MakerDeb(
      {
        options: {
          name: isStaging ? "yanrr-staging" : "yanrr",
          productName: isStaging ? "Yanrr Staging" : "Yanrr",
          // must match the executable emitted by electron-packager (packagerConfig.name)
          bin: isStaging ? "Yanrr Staging" : "Yanrr",
          genericName: "RSS Reader",
          description: "Self-hosted personal RSS reader",
          maintainer: "Bliod-Cook",
          categories: ["Network", "News"],
          section: "web",
          icon: isStaging ? "resources/icon-staging.png" : "resources/icon.png",
          mimeType: ["x-scheme-handler/yanrr"],
        },
      },
      ["linux"],
    ),
    // Without an iconUrl, Programs and Features shows the Electron icon: Squirrel downloads it at
    // install time, and the app has no public URL to serve one from
    new MakerSquirrel({
      name: "Yanrr",
      setupIcon: isStaging ? "resources/icon-staging.ico" : "resources/icon.ico",
    }),
  ],
  plugins: [
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    // Apple silicon launches only a validly signed app. The fuses plugin signs the arm64 app ad hoc,
    // but packaging then rewrites its Info.plist, which breaks that signature.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== "darwin" || process.env.OSX_SIGN_IDENTITY) return
      for (const outputPath of outputPaths) {
        for (const app of readdirSync(outputPath).filter((file) => file.endsWith(".app"))) {
          execFileSync("codesign", ["--force", "--deep", "--sign", "-", path.join(outputPath, app)])
        }
      }
    },
    postMake: async (_config, makeResults) => {
      return makeResults.map((result) => {
        result.artifacts = result.artifacts
          .map((artifact) => {
            if (artifactRegex.test(artifact)) {
              const newArtifact = `${path.dirname(artifact)}/${
                result.packageJSON.productName
              }-${result.packageJSON.version}-${
                platformNamesMap[result.platform]
              }-${result.arch}${path.extname(artifact)}`
              fs.renameSync(artifact, newArtifact)
              return newArtifact
            } else if (!artifact.endsWith(".tmp")) {
              return artifact
            } else {
              return null
            }
          })
          .filter((artifact) => artifact !== null)
        return result
      })
    },
  },
}

export default config
