import { cn } from "@follow/utils"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Pressable, TouchableWithoutFeedback, View } from "react-native"
import { KeyboardAvoidingView, KeyboardController } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useRegistrationOpen } from "@/src/atoms/server-configs"
import { Logo } from "@/src/components/ui/logo"
import { Text } from "@/src/components/ui/typography/Text"
import { useIsTabletLayout, useReadableContainerStyle, useScaleHeight } from "@/src/lib/responsive"
import { isServerUrlBuiltIn, useServerUrl } from "@/src/lib/server-env"

import { EmailLogin, EmailSignUp } from "./email"
import { hasSignedInBefore } from "./returning-user"
import { CurrentServer, ServerForm } from "./server"

export function Login() {
  const insets = useSafeAreaInsets()
  const scaledHeight = useScaleHeight()
  const isTablet = useIsTabletLayout()
  const contentWidthStyle = useReadableContainerStyle(480)
  const logoSize = scaledHeight(80)
  const gapSize = scaledHeight(28)
  const fontSize = scaledHeight(28)
  const lineHeight = scaledHeight(32)
  const { t } = useTranslation()
  // Whoever signed in on this device before, as before an expired session, comes back to sign in
  const [wantsRegister, setWantsRegister] = useState(() => !hasSignedInBefore())
  // A server that closed registration offers the sign-in only
  const registrationOpen = useRegistrationOpen()
  const isRegister = registrationOpen && wantsRegister
  const server = useServerUrl()
  const [isChangingServer, setIsChangingServer] = useState(false)
  // The server comes first: the credentials are for an account on it
  const currentServer = isChangingServer ? null : server
  return (
    <View
      testID="login-screen"
      className={cn("pb-safe-or-2 flex-1", isTablet ? "justify-center px-6" : "justify-between")}
      style={{
        paddingTop: insets.top + (isTablet ? 36 : 56),
        paddingBottom: insets.bottom + (isTablet ? 32 : 0),
      }}
    >
      <KeyboardAvoidingView behavior={"position"} style={contentWidthStyle}>
        <TouchableWithoutFeedback
          onPress={() => {
            KeyboardController.dismiss()
          }}
          accessible={false}
        >
          <View
            className="items-center"
            style={{
              gap: gapSize,
            }}
          >
            <Logo
              style={{
                width: logoSize,
                height: logoSize,
              }}
            />
            <Text
              style={{
                fontSize,
                lineHeight,
              }}
            >
              <Text className="text-3xl font-semibold">{`${isRegister ? t("signin.sign_up_to") : t("signin.sign_in_to")} `}</Text>
              <Text className="text-3xl font-bold">Yanrr</Text>
            </Text>
            {currentServer ? (
              <>
                <CurrentServer
                  server={currentServer}
                  onChange={isServerUrlBuiltIn ? undefined : () => setIsChangingServer(true)}
                />
                {isRegister ? <EmailSignUp /> : <EmailLogin />}
              </>
            ) : (
              <ServerForm onCancel={server ? () => setIsChangingServer(false) : undefined} />
            )}
          </View>
        </TouchableWithoutFeedback>
        {!isTablet && currentServer && registrationOpen && (
          <View className="mt-14">
            <AuthModeToggle
              isRegister={isRegister}
              onToggle={() => setWantsRegister(!isRegister)}
            />
          </View>
        )}
      </KeyboardAvoidingView>
      {isTablet && currentServer && registrationOpen && (
        <View style={contentWidthStyle}>
          <View className="mt-8">
            <AuthModeToggle
              isRegister={isRegister}
              onToggle={() => setWantsRegister(!isRegister)}
            />
          </View>
        </View>
      )}
    </View>
  )
}

function AuthModeToggle({ isRegister, onToggle }: { isRegister: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <Pressable testID="auth-toggle-mode" onPress={onToggle}>
      <Text className="pb-2 text-center text-lg font-medium text-label">
        <Trans
          t={t}
          i18nKey={isRegister ? "login.have_account" : "login.no_account"}
          components={{
            strong: <Text className="text-accent" />,
          }}
        />
      </Text>
    </Pressable>
  )
}
