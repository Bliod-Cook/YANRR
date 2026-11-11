const path = require("pathe")

// Expo copies the Firebase config file of each platform, and sets up Android with it, by itself.
// iOS also has to configure Firebase at launch, which only React Native Firebase's plugin adds. Its
// Android half fails without google-services.json, so the app applies only this iOS step of it.
const { withFirebaseAppDelegate } = require(
  path.join(
    path.dirname(require.resolve("@react-native-firebase/app/package.json")),
    "plugin/build/ios",
  ),
)

module.exports = withFirebaseAppDelegate
