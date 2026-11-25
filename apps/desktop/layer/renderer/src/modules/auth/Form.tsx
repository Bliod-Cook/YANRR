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
import { zodResolver } from "@hookform/resolvers/zod"
import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { Trans, useTranslation } from "react-i18next"
import { z } from "zod"

import { signInWithEmail, signUpWithEmail } from "~/lib/auth"
import { handleSessionChanges, succeededOrToast } from "~/queries/auth"

const passwordSchema = z.string().min(8).max(128)

const formSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
})

/** Signs in or up and starts the app over as that user. A failure is said, and the form stays. */
const enterWith = async (request: Parameters<typeof succeededOrToast>[0]) => {
  if (await succeededOrToast(request)) handleSessionChanges()
}

/** Without `onLoginStateChange` the form offers signing in only */
export function LoginWithPassword({
  onLoginStateChange,
}: {
  onLoginStateChange?: (state: "register" | "login") => void
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

  const onSubmit = ({ email, password }: z.infer<typeof formSchema>) =>
    enterWith(() => signInWithEmail(email, password))

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

      {onLoginStateChange && (
        <>
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
                    className="inline-flex cursor-pointer items-center gap-1 text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:outline-none"
                    onClick={() => onLoginStateChange("register")}
                  />
                ),
              }}
            />
          </div>
        </>
      )}
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

  const onSubmit = ({ email, password }: RegisterFormValues) =>
    enterWith(() => signUpWithEmail(email, password))

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
                className="inline-flex cursor-pointer items-center gap-1 text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:outline-none"
                onClick={() => onLoginStateChange("login")}
              />
            ),
          }}
        />
      </div>
    </div>
  )
}
