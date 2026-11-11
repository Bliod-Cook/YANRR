import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Pressable, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"

import { SubmitButton } from "@/src/components/common/SubmitButton"
import { PlainTextField } from "@/src/components/ui/form/TextField"
import { Text } from "@/src/components/ui/typography/Text"
import { setServerUrl } from "@/src/lib/auth"
import { accentColor } from "@/src/theme/colors"

/** Sets the server to sign in to; the app reloads with it */
export function ServerForm({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState("")
  const connectMutation = useMutation({ mutationFn: setServerUrl })
  const error = connectMutation.data
  const connect = () => {
    void KeyboardController.dismiss()
    connectMutation.mutate(url)
  }

  return (
    <View className="mx-auto flex w-full max-w-sm">
      <View className="flex-row rounded-2xl bg-secondary-system-background px-6 py-4">
        <PlainTextField
          testID="login-server-input"
          value={url}
          onChangeText={setUrl}
          selectionColor={accentColor}
          hitSlop={20}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          placeholder={t("login.server_address")}
          className="flex-1 text-text"
          returnKeyType="go"
          onSubmitEditing={connect}
        />
      </View>
      {error && (
        <Text className="mt-3 text-center text-red">{t(`login.server_${error}` as const)}</Text>
      )}
      <SubmitButton
        testID="login-server-submit"
        isLoading={connectMutation.isPending}
        disabled={!url.trim()}
        onPress={connect}
        title={t("login.server_connect")}
        className="mt-8"
      />
      {onCancel && (
        <Pressable className="mt-4" onPress={onCancel}>
          <Text className="text-center text-secondary-label">
            {t("words.cancel", { ns: "common" })}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** Offers to change the server unless the build comes with its own */
export function CurrentServer({ server, onChange }: { server: string; onChange?: () => void }) {
  const { t } = useTranslation()
  const { host, protocol } = new URL(server)
  return (
    <View className="items-center gap-1">
      <View className="flex-row items-center justify-center gap-1.5">
        <Text className="text-secondary-label">{t("login.server", { host })}</Text>
        {onChange && (
          <>
            <Text className="text-secondary-label">·</Text>
            <Pressable testID="login-server-change" hitSlop={10} onPress={onChange}>
              <Text className="text-accent">{t("login.server_change")}</Text>
            </Pressable>
          </>
        )}
      </View>
      {protocol === "http:" && (
        <Text className="text-center text-red">{t("login.server_insecure")}</Text>
      )}
    </View>
  )
}
