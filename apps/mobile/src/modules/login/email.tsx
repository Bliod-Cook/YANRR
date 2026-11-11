import { userSyncService } from "@follow/store/user/store"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import i18next from "i18next"
import { useCallback, useMemo, useState } from "react"
import type { Control } from "react-hook-form"
import { useController, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import type { TextInputProps } from "react-native"
import { Alert, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { z } from "zod"

import { SubmitButton } from "@/src/components/common/SubmitButton"
import { PlainTextField } from "@/src/components/ui/form/TextField"
import { getCookie, signIn, signUp } from "@/src/lib/auth"
import { getAuthErrorMessage } from "@/src/lib/error-parser"
import { Navigation } from "@/src/lib/navigation/Navigation"
import { toast } from "@/src/lib/toast"
import { accentColor } from "@/src/theme/colors"

const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
})
type FormValue = z.infer<typeof formSchema>

async function onSubmit(values: FormValue) {
  return signInWithEmail(values)
}

async function signInWithEmail(values: FormValue) {
  const result = formSchema.safeParse(values)
  if (!result.success) {
    const issue = result.error.issues[0]
    Alert.alert(i18next.t("login.invalid_email_or_password"), issue?.message)
    return false
  }

  try {
    const res = await signIn.email({
      email: result.data.email,
      password: result.data.password,
    })

    if (res.error) {
      throw new Error(getAuthErrorMessage(res.error))
    }
  } catch (error) {
    Alert.alert(
      error instanceof Error
        ? error.message
        : i18next.t("auth.error.sign_in_failed", { ns: "common" }),
    )
    return false
  }

  await userSyncService.whoami()
  return true
}

export function EmailLogin() {
  const { t } = useTranslation()
  const [emailValue, setEmailValue] = useState("")
  const [passwordValue, setPasswordValue] = useState("")
  const submitMutation = useMutation({
    mutationFn: onSubmit,
  })
  const onLogin = useCallback(() => {
    void KeyboardController.dismiss()
    submitMutation.mutate({
      email: emailValue,
      password: passwordValue,
    })
  }, [emailValue, passwordValue, submitMutation])

  return (
    <View className="mx-auto flex w-full max-w-sm">
      <View className="gap-4 rounded-2xl bg-secondary-system-background px-6 py-4">
        <View className="flex-row">
          <PlainTextField
            testID="login-email-input"
            value={emailValue}
            onChangeText={setEmailValue}
            selectionColor={accentColor}
            hitSlop={20}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            importantForAutofill="auto"
            placeholder={t("login.email")}
            className="flex-1 text-text"
            returnKeyType="next"
            onSubmitEditing={() => {
              KeyboardController.setFocusTo("next")
            }}
          />
        </View>
        <View className="border-b-hairline border-b-opaque-separator" />
        <View className="flex-row">
          <PlainTextField
            testID="login-password-input"
            value={passwordValue}
            onChangeText={setPasswordValue}
            selectionColor={accentColor}
            hitSlop={20}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            importantForAutofill="auto"
            placeholder={t("login.password")}
            className="flex-1 text-text"
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={onLogin}
          />
        </View>
      </View>
      <SubmitButton
        isLoading={submitMutation.isPending}
        testID="login-submit"
        onPress={onLogin}
        title={t("login.submit")}
        className="mt-8"
      />
    </View>
  )
}

// Signup

// Built when needed, as the message follows the language of the moment
const createSignupFormSchema = () =>
  z
    .object({
      email: z.string().email(),
      password: z.string().min(8).max(128),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: i18next.t("login.passwords_do_not_match"),
      path: ["confirmPassword"],
    })
type SignupFormValue = z.infer<ReturnType<typeof createSignupFormSchema>>
function SignupInput({
  control,
  name,
  ...rest
}: TextInputProps & {
  control: Control<SignupFormValue>
  name: keyof SignupFormValue
}) {
  const { field } = useController({
    control,
    name,
  })
  return (
    <PlainTextField
      selectionColor={accentColor}
      {...rest}
      value={field.value}
      onChangeText={field.onChange}
    />
  )
}
export function EmailSignUp() {
  const { t } = useTranslation()
  const signupFormSchema = useMemo(createSignupFormSchema, [t])
  const { control, handleSubmit } = useForm<SignupFormValue>({
    resolver: zodResolver(signupFormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  })
  const submitMutation = useMutation({
    mutationFn: async (values: SignupFormValue) => {
      const res = await signUp.email({
        email: values.email,
        password: values.password,
        name: values.email.split("@")[0] ?? "",
      })

      if (res.error) {
        toast.error(getAuthErrorMessage(res.error))
        return
      }

      if (!(await getCookie())) {
        const signedIn = await signInWithEmail({
          email: values.email,
          password: values.password,
        })

        if (!signedIn) {
          return
        }
      }

      toast.success(i18next.t("login.sign_up_successful"))
      Navigation.rootNavigation.back()
    },
  })
  const signup = handleSubmit(
    (values) => {
      void KeyboardController.dismiss()
      submitMutation.mutate(values)
    },
    (errors) => {
      Alert.alert(t("login.invalid_email_or_password"), Object.values(errors)[0]?.message)
    },
  )

  return (
    <View className="mx-auto flex w-full max-w-sm">
      <View className="gap-4 rounded-2xl bg-secondary-system-background px-6 py-4">
        <View className="flex-row">
          <SignupInput
            testID="register-email-input"
            hitSlop={20}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            importantForAutofill="auto"
            control={control}
            name="email"
            placeholder={t("login.email")}
            className="flex-1 text-text"
            returnKeyType="next"
            onSubmitEditing={() => {
              KeyboardController.setFocusTo("next")
            }}
          />
        </View>
        <View className="border-b-hairline border-b-opaque-separator" />
        <View className="flex-row">
          <SignupInput
            testID="register-password-input"
            hitSlop={20}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password-new"
            textContentType="newPassword"
            importantForAutofill="auto"
            control={control}
            name="password"
            placeholder={t("login.password")}
            className="flex-1 text-text"
            secureTextEntry
            returnKeyType="next"
          />
        </View>
        <View className="border-b-hairline border-b-opaque-separator" />
        <View className="flex-row">
          <SignupInput
            testID="register-confirm-password-input"
            hitSlop={20}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password-new"
            textContentType="newPassword"
            importantForAutofill="auto"
            control={control}
            name="confirmPassword"
            placeholder={t("login.confirm_password.label")}
            className="flex-1 text-text"
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={() => {
              signup()
            }}
          />
        </View>
      </View>
      <SubmitButton
        disabled={submitMutation.isPending}
        isLoading={submitMutation.isPending}
        testID="register-submit"
        onPress={signup}
        title={t("login.submit")}
        className="mt-8"
      />
    </View>
  )
}
