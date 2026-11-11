const { withGradleProperties } = require("expo/config-plugins")

const PROPERTIES = {
  // Builds fail at random with the template's heap, see https://github.com/expo/expo/issues/30413
  "org.gradle.jvmargs": "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
  // The build runs on JDK 21, which libraries targeting older Java versions would otherwise fail on
  "react.internal.disableJavaVersionAlignment": "true",
  "kotlin.jvm.target.validation.mode": "warning",
}

module.exports = function withAndroidGradleProperties(config) {
  return withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const property = { type: "property", key, value }
      const index = config.modResults.findIndex(
        (item) => item.type === "property" && item.key === key,
      )
      if (index === -1) {
        config.modResults.push(property)
      } else {
        config.modResults[index] = property
      }
    }
    return config
  })
}
