import { Button } from "@follow/components/ui/button/index.js"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@follow/components/ui/form/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import type { FeedViewType } from "@follow/constants"
import { zodResolver } from "@hookform/resolvers/zod"
import i18next from "i18next"
import { useCallback } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { useCurrentModal, useModalStack } from "~/components/ui/modal/stacked/hooks"
import { useBatchUpdateSubscription } from "~/hooks/biz/useSubscriptionActions"

const categoryFormSchema = z.object({
  // A name of only spaces would make a folder without a name
  categoryName: z
    .string()
    .trim()
    .min(1, {
      error: () => i18next.t("sidebar.feed_column.context_menu.new_category_modal.name_required"),
    }),
})

const CategoryCreationModalContent = ({ onSubmit }: { onSubmit: (category: string) => void }) => {
  const { dismiss } = useCurrentModal()
  const { t } = useTranslation()

  const form = useForm<z.infer<typeof categoryFormSchema>>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      categoryName: "",
    },
  })

  const handleSubmit = form.handleSubmit(({ categoryName }) => {
    onSubmit(categoryName)
    dismiss()
  })

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="space-y-4 lg:w-[450px]">
        <FormField
          control={form.control}
          name="categoryName"
          render={({ field }) => (
            <FormItem>
              <div>
                <FormLabel>
                  {t("sidebar.feed_column.context_menu.new_category_modal.category_name")}
                  <sup className="ml-1 align-sub text-red-500">*</sup>
                </FormLabel>
              </div>
              <FormControl>
                <Input autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit">
            {t("sidebar.feed_column.context_menu.new_category_modal.create")}
          </Button>
        </div>
      </form>
    </Form>
  )
}

export const useCategoryCreationModal = () => {
  const { t } = useTranslation()
  const { present } = useModalStack()
  const { mutate: addFeedsToCategoryMutation } = useBatchUpdateSubscription()
  return useCallback(
    (view: FeedViewType, feedIds: string[]) =>
      present({
        title: t("sidebar.feed_column.context_menu.title"),
        content: () => (
          <CategoryCreationModalContent
            onSubmit={(category: string) => {
              addFeedsToCategoryMutation({
                feedIdList: feedIds,
                category,
                view: view!,
              })
            }}
          />
        ),
      }),
    [addFeedsToCategoryMutation, present, t],
  )
}
