import { useWhoami } from "@follow/store/user/hooks"
import { userSyncService } from "@follow/store/user/store"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyboardAvoidingView, TouchableWithoutFeedback, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"

import { HeaderSubmitTextButton } from "@/src/components/layouts/header/HeaderElements"
import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import { UserAvatar } from "@/src/components/ui/avatar/UserAvatar"
import { PlainTextField } from "@/src/components/ui/form/TextField"
import {
  GroupedInsetListCard,
  GroupedInsetListCell,
  GroupedOutlineDescription,
} from "@/src/components/ui/grouped/GroupedList"
import { PlatformActivityIndicator } from "@/src/components/ui/loading/PlatformActivityIndicator"
import { toast } from "@/src/lib/toast"
import { accentColor } from "@/src/theme/colors"

export const EditProfileScreen = () => {
  const whoami = useWhoami()
  const { t } = useTranslation("settings")
  const [name, setName] = useState<string>()
  const nameError =
    name !== undefined && !name.trim() ? t("validation.required", { ns: "common" }) : undefined

  const { mutate: updateProfile, isPending } = useMutation({
    mutationFn: () => userSyncService.updateProfile({ name }),
    onSuccess: () => {
      toast.success(t("profile.updateSuccess"))
      setName(undefined)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  if (!whoami) {
    return (
      <View className="flex-1 items-center justify-center">
        <PlatformActivityIndicator />
      </View>
    )
  }
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <SafeNavigationScrollView
        keyboardShouldPersistTaps="handled"
        Header={
          <NavigationBlurEffectHeaderView
            headerRight={
              <HeaderSubmitTextButton
                label={t("words.save", {
                  ns: "common",
                })}
                isValid={name !== undefined && !nameError}
                isLoading={isPending}
                onPress={() => {
                  updateProfile()
                }}
              />
            }
            title={t("profile.edit_profile")}
          />
        }
        className="bg-system-grouped-background"
      >
        <View className="mt-6 items-center justify-center">
          <UserAvatar image={whoami.image} name={whoami.name} size={80} />
        </View>
        <TouchableWithoutFeedback onPress={() => KeyboardController.dismiss()}>
          <View className="mt-4">
            <GroupedInsetListCard>
              <GroupedInsetListCell
                label={t("profile.name.label")}
                leftClassName="flex-none"
                rightClassName="flex-1"
              >
                <View className="flex-1">
                  <PlainTextField
                    className="w-full flex-1 text-right text-secondary-label"
                    value={name ?? whoami.name ?? ""}
                    hitSlop={10}
                    selectionColor={accentColor}
                    onChangeText={setName}
                  />
                </View>
              </GroupedInsetListCell>
            </GroupedInsetListCard>
            {nameError && <GroupedOutlineDescription description={nameError} isError />}
            <GroupedOutlineDescription description={t("profile.name.description")} />
          </View>
        </TouchableWithoutFeedback>
      </SafeNavigationScrollView>
    </KeyboardAvoidingView>
  )
}
