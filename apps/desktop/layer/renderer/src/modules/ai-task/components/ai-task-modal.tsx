import { Button } from "@follow/components/ui/button/index.js"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@follow/components/ui/form/index.jsx"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import type { LexicalRichEditorRef } from "@follow/components/ui/lexical-rich-editor/index.js"
import { LexicalRichEditorTextArea } from "@follow/components/ui/lexical-rich-editor/index.js"
import type { AITask } from "@follow-app/client-sdk"
import { zodResolver } from "@hookform/resolvers/zod"
import dayjs from "dayjs"
import { $getRoot } from "lexical"
import { useMemo, useRef, useState } from "react"
import type { GlobalError } from "react-hook-form"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useCurrentModal } from "~/components/ui/modal/stacked/hooks"
import { createErrorToaster } from "~/lib/error-parser"
import { MentionPlugin, ShortcutPlugin } from "~/modules/ai-chat/editor"
import { useCreateAITaskMutation, useUpdateAITaskMutation } from "~/modules/ai-task/query"
import type { ScheduleType, TaskFormData } from "~/modules/ai-task/types"
import { createTaskSchema, MAX_PROMPT_LENGTH } from "~/modules/ai-task/types"

import { ScheduleConfig } from "./schedule-config"

interface AITaskModalProps {
  task?: AITask // Existing task for editing (optional)
}

// Convert existing task data to form format or use defaults
const getDefaultFormData = (task?: AITask): TaskFormData => {
  // Get current date/time for default values
  const now = dayjs()

  if (!task) {
    // Default values for creating new task
    return {
      name: "AI Task",
      prompt: "",
      schedule: {
        type: "once",
        date: now.add(1, "hour").toISOString(),
      },
    }
  }

  // Convert existing task data for editing
  const { schedule } = task
  let formSchedule: TaskFormData["schedule"]

  switch (schedule.type) {
    case "once": {
      formSchedule = {
        type: "once",
        date: dayjs(schedule.date).toISOString(),
      }
      break
    }
    case "daily": {
      formSchedule = {
        type: "daily",
        timeOfDay: dayjs(schedule.timeOfDay).toISOString(),
      }
      break
    }
    case "weekly": {
      formSchedule = {
        type: "weekly",
        dayOfWeek: schedule.dayOfWeek,
        timeOfDay: dayjs(schedule.timeOfDay).toISOString(),
      }
      break
    }
    case "monthly": {
      formSchedule = {
        type: "monthly",
        dayOfMonth: schedule.dayOfMonth,
        timeOfDay: dayjs(schedule.timeOfDay).toISOString(),
      }
      break
    }
    default: {
      formSchedule = {
        type: "once",
        date: now.add(1, "hour").toISOString(),
      }
    }
  }

  return {
    name: task.name,
    prompt: task.prompt,
    schedule: formSchedule,
  }
}

export const AITaskModal = ({ task }: AITaskModalProps) => {
  const { dismiss } = useCurrentModal()
  const createAITaskMutation = useCreateAITaskMutation()
  const updateAITaskMutation = useUpdateAITaskMutation()
  const { t } = useTranslation("ai")

  const isEditing = !!task

  // Uncontrolled prompt state handled outside react-hook-form
  const promptEditorRef = useRef<LexicalRichEditorRef | null>(null)
  const [promptTextLength, setPromptTextLength] = useState(0)

  const taskSchema = useMemo(
    () =>
      createTaskSchema(t, () => {
        const editor = promptEditorRef.current?.getEditor()
        return editor ? editor.getEditorState().read(() => $getRoot().getTextContent()) : ""
      }),
    [t],
  )
  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: getDefaultFormData(task),
  })

  const scheduleValue = form.watch("schedule")

  const initialPromptRef = useRef(form.getValues("prompt"))

  const handleScheduleChange = (newSchedule: ScheduleType) => {
    form.setValue("schedule", newSchedule)
  }

  const handleSubmit = async (data: TaskFormData) => {
    // The optimistic mutations roll back on failure; the toasts are shown here
    if (isEditing) {
      // Update existing task
      updateAITaskMutation.mutate(
        {
          id: task.id,
          ...data,
        },
        {
          onSuccess: () => {
            toast.success(t("tasks.toast.updated"))
            dismiss()
          },
          onError: createErrorToaster(t("tasks.toast.update_failed")),
        },
      )
    } else {
      // Create new task
      createAITaskMutation.mutate(data, {
        onSuccess: () => {
          toast.success(t("tasks.toast.created"))
          dismiss()
        },
        onError: createErrorToaster(t("tasks.toast.create_failed")),
      })
    }
  }

  const currentMutation = isEditing ? updateAITaskMutation : createAITaskMutation

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    if (!promptEditorRef.current) return
    const promptValue = JSON.stringify(
      promptEditorRef.current?.getEditor().getEditorState().toJSON(),
    )

    form.setValue("prompt", promptValue, { shouldDirty: true, shouldValidate: true })
    return form.handleSubmit(handleSubmit)(e)
  }

  return (
    <div className="w-[500px] max-w-full space-y-6">
      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Task Basic Information Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <i className="i-mgc-file-upload-cute-re size-4 text-text-secondary" />
              <h3 className="text-sm font-medium text-text">{t("tasks.section.info")}</h3>
            </div>

            <div className="space-y-2">
              <Label className="pl-2 text-sm font-medium text-text">{t("tasks.name")}</Label>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input placeholder={t("tasks.name_placeholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Schedule Configuration Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <i className="i-mgc-calendar-time-add-cute-re size-4 text-text-secondary" />
              <h3 className="text-sm font-medium text-text">{t("tasks.section.schedule")}</h3>
            </div>

            <ScheduleConfig
              value={scheduleValue}
              onChange={handleScheduleChange}
              errors={form.formState.errors.schedule as Record<string, GlobalError>}
            />
          </div>

          {/* AI Prompt Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <i className="i-mgc-magic-2-cute-re size-4 text-text-secondary" />
              <h3 className="text-sm font-medium text-text">{t("tasks.section.instructions")}</h3>
            </div>

            <div className="space-y-2">
              <Label className="pl-2 text-sm font-medium text-text">{t("tasks.prompt")}</Label>
              <LexicalRichEditorTextArea
                initialValue={initialPromptRef.current}
                ref={promptEditorRef}
                onLengthChange={(textLength) => {
                  setPromptTextLength(textLength)
                }}
                plugins={[MentionPlugin, ShortcutPlugin]}
                namespace="AITaskPromptEditor"
                placeholder={t("tasks.prompt_placeholder")}
                className="min-h-[120px] resize-none text-sm leading-relaxed"
              />
              <div className="flex items-center justify-between">
                <div className="text-xs text-text-tertiary">{t("tasks.prompt_helper")}</div>
                {promptTextLength > MAX_PROMPT_LENGTH * 0.8 && (
                  <div className="text-xs font-medium text-text-secondary">
                    {promptTextLength}/{MAX_PROMPT_LENGTH}
                  </div>
                )}
              </div>
              {(form.formState.errors.prompt as GlobalError | undefined)?.message && (
                <div className="text-xs text-red">
                  {(form.formState.errors.prompt as GlobalError).message}
                </div>
              )}
            </div>
          </div>

          {/* Form Actions */}

          <div className="flex items-center justify-end">
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={dismiss}
                disabled={currentMutation.isPending}
              >
                {t("words.cancel", { ns: "common" })}
              </Button>
              <Button type="submit" size="sm" disabled={currentMutation.isPending}>
                {currentMutation.isPending
                  ? isEditing
                    ? t("tasks.actions.updating")
                    : t("tasks.actions.scheduling")
                  : isEditing
                    ? t("tasks.actions.update")
                    : t("tasks.actions.schedule")}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}

AITaskModal.displayName = "AITaskModal"
