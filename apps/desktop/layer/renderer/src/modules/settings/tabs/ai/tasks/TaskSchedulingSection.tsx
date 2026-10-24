import { Button } from "@follow/components/ui/button/index.js"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { AITaskList, AITaskModal } from "~/modules/ai-task"

export const TaskSchedulingSection = () => {
  const { present } = useModalStack()
  const { t } = useTranslation("ai")

  const handleCreateTask = useCallback(() => {
    present({
      title: t("tasks.modal.new_title"),
      content: () => <AITaskModal />,
    })
  }, [present, t])

  return (
    <div className="-mt-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-text-secondary">{t("tasks.manage.desc")}</div>
        </div>

        <Button
          size={"sm"}
          variant={"outline"}
          onClick={handleCreateTask}
          buttonClassName="!-translate-y-7 shrink-0"
        >
          <i className="i-mingcute-add-line mr-2 size-4" />
          {t("tasks.actions.new_task")}
        </Button>
      </div>

      <AITaskList />
    </div>
  )
}
