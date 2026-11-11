const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins")
const fs = require("node:fs")
const path = require("pathe")

// Self-hosted servers may be plain HTTP, on the local network too, or use a certificate of a
// private CA that the user installed: network_security_config.xml allows both, in every build
const withAndroidNetworkSecurity = (config) => {
  const configWithFile = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        await AndroidConfig.Paths.getResourceFolderAsync(config.modRequest.projectRoot),
        "xml",
      )
      fs.mkdirSync(xmlDir, { recursive: true })
      fs.copyFileSync(
        path.join(__dirname, "network_security_config.xml"),
        path.join(xmlDir, "network_security_config.xml"),
      )
      return config
    },
  ])

  return withAndroidManifest(configWithFile, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults)
    mainApplication.$["android:networkSecurityConfig"] = "@xml/network_security_config"
    return config
  })
}

module.exports = withAndroidNetworkSecurity
