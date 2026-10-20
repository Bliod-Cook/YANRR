import { Avatar, AvatarFallback, AvatarImage } from "@follow/components/ui/avatar/index.jsx"
import { Button } from "@follow/components/ui/button/index.js"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@follow/components/ui/form/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import { invalidateUserSession, useWhoami } from "@follow/store/user/hooks"
import { userActions } from "@follow/store/user/store"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { updateUser } from "~/lib/auth"
import { toastFetchError } from "~/lib/error-parser"

const formItemLabelClassName = tw`pl-3`

const profileFormSchema = z.object({
  name: z.string().trim().min(1),
  image: z.string().url().or(z.literal("")),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

export const ProfileSettingForm = () => {
  const { t } = useTranslation("settings")
  const user = useWhoami()

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: user?.name || "",
      image: user?.image || "",
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const res = await updateUser(values)
      // The auth client resolves with the error instead of throwing
      if (res.error) {
        throw new Error(res.error.message || res.error.statusText)
      }
      return res
    },
    onError: (error) => toastFetchError(error),
    onSuccess: (_, values) => {
      userActions.updateWhoami(values)
      // The profile menu reads the cached session, so refresh it as well
      invalidateUserSession()
      toast(t("profile.updateSuccess"), {
        duration: 3000,
      })
    },
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
        className="mt-4 space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={formItemLabelClassName}>{t("profile.name.label")}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription className={formItemLabelClassName}>
                {t("profile.name.description")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="image"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={formItemLabelClassName}>{t("profile.avatar.label")}</FormLabel>
              <FormControl>
                <div className="flex items-center gap-4">
                  <Input {...field} placeholder="https://" />
                  <Avatar className="size-8 shrink-0">
                    <AvatarImage src={field.value} />
                    <AvatarFallback>{user?.name?.[0] || ""}</AvatarFallback>
                  </Avatar>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="text-right">
          <Button type="submit" isLoading={updateMutation.isPending}>
            {t("profile.submit")}
          </Button>
        </div>
      </form>
    </Form>
  )
}
