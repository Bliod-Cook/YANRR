import { ActivityIndicator, View } from "react-native"

import { RotateableLoading } from "./components/common/RotateableLoading"
import { GlobalErrorScreen } from "./components/errors/GlobalErrorScreen"
import { NavigationSitemapRegistry } from "./lib/navigation/sitemap/registry"
import { LoginScreen } from "./screens/(modal)/LoginScreen"
import { OnboardingScreen } from "./screens/OnboardingScreen"

export function registerSitemap() {
  NavigationSitemapRegistry.registerByComponent(LoginScreen, void 0, {
    stackPresentation: "modal",
  })
  NavigationSitemapRegistry.registerByComponent(OnboardingScreen, void 0, {
    stackPresentation: "fullScreenModal",
  })
  NavigationSitemapRegistry.registerByComponent(LoadingComponentDemo, void 0, {
    stackPresentation: "push",
  })

  // Error Boundary Template
  NavigationSitemapRegistry.registerByComponent(
    GlobalErrorScreen,
    {
      error: new Error("Test Error"),
      resetError: () => {},
    },
    {
      stackPresentation: "push",
    },
  )
}

const LoadingComponentDemo = () => {
  return (
    <View className="flex flex-1 items-center justify-center">
      <View className="flex flex-row gap-2">
        <ActivityIndicator size={"small"} />
        <RotateableLoading size={20} />
      </View>

      <View className="flex flex-row gap-2">
        <ActivityIndicator size={"small"} color="red" />
        <RotateableLoading size={20} color="red" />
      </View>

      <View className="flex flex-row gap-2">
        <ActivityIndicator size={"large"} color="red" />
        <RotateableLoading size={36} color="red" />
      </View>
    </View>
  )
}
