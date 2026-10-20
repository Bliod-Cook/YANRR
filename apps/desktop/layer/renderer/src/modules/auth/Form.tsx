import { Button } from "@follow/components/ui/button/index.js"
import { Divider } from "@follow/components/ui/divider/index.js"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@follow/components/ui/form/index.js"
import { Input } from "@follow/components/ui/input/Input.js"
import { IN_ELECTRON } from "@follow/shared/constants"
import { userActions } from "@follow/store/user/store"
import type { AuthUser } from "@follow-app/client-sdk"
import { zodResolver } from "@hookform/resolvers/zod"
import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { signIn, signUp } from "~/lib/auth"
import { ipcServices } from "~/lib/client"
import { setAuthSessionToken } from "~/lib/client-session"
import { getAuthErrorMessage } from "~/lib/error-parser"
import { handleSessionChanges } from "~/queries/auth"

const passwordSchema = z.string().min(8).max(128)

const formSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
})

const getAuthTokenFromResult = (result: unknown) => {
  if (!result || typeof result !== "object") {
    return null
  }

  if ("sessionToken" in result && typeof result.sessionToken === "string") {
    return result.sessionToken
  }

  if ("token" in result && typeof result.token === "string") {
    return result.token
  }

  if ("session" in result && result.session && typeof result.session === "object") {
    const { token } = result.session as { token?: unknown }
    if (typeof token === "string") {
      return token
    }
  }

  if (
    "data" in result &&
    result.data &&
    typeof result.data === "object" &&
    ("sessionToken" in result.data || "token" in result.data || "session" in result.data)
  ) {
    const { sessionToken, token, session } = result.data as {
      sessionToken?: unknown
      token?: unknown
      session?: { token?: unknown } | unknown
    }
    if (typeof sessionToken === "string") {
      return sessionToken
    }
    if (typeof token === "string") {
      return token
    }
    if (
      session &&
      typeof session === "object" &&
      "token" in session &&
      typeof session.token === "string"
    ) {
      return session.token
    }
    return null
  }

  return null
}

const getAuthUserFromResult = (result: unknown): AuthUser | null => {
  if (!result || typeof result !== "object") {
    return null
  }

  const data =
    "data" in result && result.data && typeof result.data === "object" ? result.data : result
  if (!("user" in data) || !data.user || typeof data.user !== "object") {
    return null
  }

  const user = data.user as { id?: unknown }
  return typeof user.id === "string" ? (data.user as AuthUser) : null
}

const persistElectronAuthUser = async (result: unknown) => {
  if (!IN_ELECTRON) {
    return
  }

  const authUser = getAuthUserFromResult(result)
  if (!authUser) {
    return
  }

  await userActions.upsertMany([
    {
      id: authUser.id,
      email: authUser.email ?? null,
      handle: authUser.handle ?? null,
      name: authUser.name ?? null,
      image: authUser.image ?? null,
      isMe: true,
      emailVerified: authUser.emailVerified ?? false,
      bio: authUser.bio ?? null,
      website: authUser.website ?? null,
      socialLinks: authUser.socialLinks ?? null,
    },
  ])
}

type ElectronAuthResult = {
  data?: Record<string, unknown>
  error?: {
    message: string
    status?: number
  } | null
}

const normalizeElectronAuthResult = (result: unknown): ElectronAuthResult => {
  if (!result || typeof result !== "object") {
    return {}
  }

  const normalized = result as ElectronAuthResult & Record<string, unknown>
  if ("data" in normalized || "error" in normalized) {
    return normalized
  }

  return {
    data: normalized,
    error: null,
  }
}

const getElectronAuthService = () => {
  if (!ipcServices) {
    return null
  }

  return ipcServices.auth as typeof ipcServices.auth & {
    signInWithCredential?: (payload: { email: string; password: string }) => Promise<unknown>
    signUpWithCredential?: (payload: {
      email: string
      password: string
      name: string
    }) => Promise<unknown>
  }
}

export function LoginWithPassword({
  onLoginStateChange,
}: {
  onLoginStateChange: (state: "register" | "login") => void
}) {
  const { t } = useTranslation("app")
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "all",
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    const res = IN_ELECTRON
      ? normalizeElectronAuthResult(
          await getElectronAuthService()?.signInWithCredential?.({
            email: values.email,
            password: values.password,
          }),
        )
      : await signIn.email({
          email: values.email,
          password: values.password,
        })
    if (res?.error) {
      toast.error(getAuthErrorMessage(res.error))
      return
    }

    if (IN_ELECTRON) {
      const token = getAuthTokenFromResult(res)
      if (token) {
        setAuthSessionToken(token)
      }
      await persistElectronAuthUser(res)
    }
    handleSessionChanges()
  }

  return (
    <Form {...form}>
      <form data-testid="login-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("login.email")}</FormLabel>
              <FormControl>
                <Input
                  data-testid="login-email-input"
                  type="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  inputMode="email"
                  spellCheck={false}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="mt-4">
              <FormLabel>{t("login.password")}</FormLabel>
              <FormControl>
                <Input
                  data-testid="login-password-input"
                  type="password"
                  autoCapitalize="none"
                  autoComplete="current-password"
                  autoCorrect="off"
                  spellCheck={false}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col space-y-3">
          <Button
            data-testid="login-submit"
            type="submit"
            isLoading={form.formState.isSubmitting}
            disabled={!form.formState.isValid}
            size="lg"
          >
            {t("login.continueWith", { provider: t("words.email") })}
          </Button>
        </div>
      </form>

      <Divider className="my-4" />

      <div className="pb-2 text-center text-sm text-text-secondary">
        <Trans
          t={t}
          i18nKey="login.no_account"
          components={{
            strong: (
              <button
                data-testid="login-switch-register"
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2"
                onClick={() => onLoginStateChange("register")}
              />
            ),
          }}
        />
      </div>
    </Form>
  )
}

const createRegisterFormSchema = (t: TFunction<"app">) =>
  z
    .object({
      email: z.string().email(),
      password: passwordSchema,
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("login.passwords_do_not_match"),
      path: ["confirmPassword"],
    })

type RegisterFormValues = z.infer<ReturnType<typeof createRegisterFormSchema>>

export function RegisterForm({
  onLoginStateChange,
}: {
  onLoginStateChange: (state: "register" | "login") => void
}) {
  const { t } = useTranslation("app")

  const registerFormSchema = useMemo(() => createRegisterFormSchema(t), [t])
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
    mode: "all",
  })

  async function onSubmit(values: RegisterFormValues) {
    const result = IN_ELECTRON
      ? normalizeElectronAuthResult(
          await getElectronAuthService()?.signUpWithCredential?.({
            email: values.email,
            password: values.password,
            name: values.email.split("@")[0]!,
          }),
        )
      : await signUp.email(
          {
            email: values.email,
            password: values.password,
            name: values.email.split("@")[0]!,
          },
          {
            onError(context) {
              toast.error(getAuthErrorMessage(context.error))
            },
          },
        )

    if (result?.error) {
      // The web client's onError above already said why
      if (IN_ELECTRON) toast.error(getAuthErrorMessage(result.error))
      return result
    }

    if (IN_ELECTRON) {
      const token = getAuthTokenFromResult(result)
      if (token) {
        setAuthSessionToken(token)
      }
      await persistElectronAuthUser(result)
    }

    handleSessionChanges()

    return result
  }

  return (
    <div className="relative">
      <Form {...form}>
        <form
          data-testid="register-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("register.email")}</FormLabel>
                <FormControl>
                  <Input
                    data-testid="register-email-input"
                    type="email"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect="off"
                    inputMode="email"
                    spellCheck={false}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("register.password")}</FormLabel>
                <FormControl>
                  <Input
                    data-testid="register-password-input"
                    type="password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect="off"
                    spellCheck={false}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("register.confirm_password")}</FormLabel>
                <FormControl>
                  <Input
                    data-testid="register-confirm-password-input"
                    type="password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect="off"
                    spellCheck={false}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            data-testid="register-submit"
            type="submit"
            buttonClassName="w-full"
            size="lg"
            isLoading={form.formState.isSubmitting}
            disabled={!form.formState.isValid}
          >
            {t("register.submit")}
          </Button>
        </form>
      </Form>
      <Divider className="my-4" />

      <div className="pb-2 text-center text-sm text-text-secondary">
        <Trans
          t={t}
          i18nKey="login.have_account"
          components={{
            strong: (
              <button
                data-testid="register-switch-login"
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2"
                onClick={() => onLoginStateChange("login")}
              />
            ),
          }}
        />
      </div>
    </div>
  )
}
