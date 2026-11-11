import { Button } from "@follow/components/ui/button/index.js"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@follow/components/ui/form/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.js"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import type { TFunction } from "i18next"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { useCurrentModal, useModalStack } from "~/components/ui/modal/stacked/hooks"
import { changePassword } from "~/lib/auth"
import { getAuthErrorMessage } from "~/lib/error-parser"

const passwordSchema = z.string().min(8).max(128)

const createUpdatePasswordFormSchema = (t: TFunction<"app">) =>
  z
    .object({
      currentPassword: passwordSchema,
      newPassword: passwordSchema,
      confirmPassword: passwordSchema,
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: t("login.passwords_do_not_match"),
      path: ["confirmPassword"],
    })

type UpdatePasswordFormValues = z.infer<ReturnType<typeof createUpdatePasswordFormSchema>>

const UpdateExistingPasswordForm = () => {
  const { t } = useTranslation("settings")

  const { t: tApp } = useTranslation("app")
  const { dismiss } = useCurrentModal()

  const updatePasswordFormSchema = useMemo(() => createUpdatePasswordFormSchema(tApp), [tApp])
  const form = useForm<UpdatePasswordFormValues>({
    resolver: zodResolver(updatePasswordFormSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (values: UpdatePasswordFormValues) => {
      const res = await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      })
      if (res.error) {
        throw new Error(getAuthErrorMessage(res.error))
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
    onSuccess: (_) => {
      toast.success(t("profile.update_password_success"), {
        duration: 3000,
      })
      dismiss()
    },
  })

  function onSubmit(values: UpdatePasswordFormValues) {
    updateMutation.mutate(values)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-[35ch] max-w-full space-y-4">
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  autoFocus
                  type="password"
                  placeholder={t("profile.current_password.label")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input type="password" placeholder={t("profile.new_password.label")} {...field} />
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
              <FormControl>
                <Input
                  type="password"
                  placeholder={t("profile.confirm_password.label")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" isLoading={updateMutation.isPending}>
            {t("profile.submit")}
          </Button>
        </div>
      </form>
    </Form>
  )
}

export const UpdatePasswordForm = () => {
  const { t } = useTranslation("settings")
  const { present } = useModalStack()

  return (
    <div className="flex items-center justify-between">
      <Label>{t("profile.password.label")}</Label>
      <Button
        variant="outline"
        onClick={() =>
          present({
            title: t("profile.change_password.label"),
            content: UpdateExistingPasswordForm,
          })
        }
      >
        {t("profile.change_password.label")}
      </Button>
    </div>
  )
}
