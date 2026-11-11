import type { WithOptimistic } from "@follow/hooks"
import { createOptimisticConfig, useOptimisticMutation } from "@follow/hooks"
import type {
  AITask,
  CreateTaskRequest,
  TaskCreateResponse,
  UpdateTaskRequest,
} from "@follow-app/client-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { followApi } from "~/lib/api-client"

// Use the generic optimistic wrapper type
type OptimisticAITask = WithOptimistic<AITask>

// Callers report failures themselves, translated
const withoutErrorToast = <T extends { errorConfig?: { showToast?: boolean } }>(config: T): T => ({
  ...config,
  errorConfig: { ...config.errorConfig, showToast: false },
})

const aiTaskKey = "ai-task"
export const aiTaskKeys = {
  list: [aiTaskKey, "list"] as const,
  details: [aiTaskKey, "detail"] as const,
  detail: (id: string) => [...aiTaskKeys.details, id] as const,
  testRun: [aiTaskKey, "test-run"] as const,
}

// Queries

export const useAITaskListQuery = () => {
  const { data } = useQuery({
    queryKey: aiTaskKeys.list,
    queryFn: () => followApi.aiTask.list().then((res) => res.data),
  })
  return data
}

export const useAITaskQuery = (id: string | undefined, opts?: { enabled?: boolean }) => {
  const enabled = !!id && (opts?.enabled ?? true)
  const { data } = useQuery({
    queryKey: id ? aiTaskKeys.detail(id) : aiTaskKeys.details,
    queryFn: () => followApi.aiTask.get({ id: id as string }),
    enabled,
  })
  return data?.data
}

// Mutations

export const useCreateAITaskMutation = () => {
  return useOptimisticMutation(
    withoutErrorToast(
      createOptimisticConfig.forCreate<
        OptimisticAITask,
        Omit<CreateTaskRequest, "options">,
        TaskCreateResponse
      >({
        // A task has no options: they only held notification channels
        mutationFn: (input) => followApi.aiTask.create({ ...input, options: {} }),
        queryKey: aiTaskKeys.list,
        generateOptimistic: (variables) => ({
          name: variables.name,
          prompt: variables.prompt,
          isEnabled: variables.isEnabled ?? true,
          schedule: variables.schedule,
          options: {},
          userId: "temp-user",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastRunAt: null,
          nextRunAt: null,
          runCount: 0,
          lastResult: null,
          lastError: null,
        }),
        retryable: false,
      }),
    ),
  )
}

export const useUpdateAITaskMutation = () => {
  return useOptimisticMutation(
    withoutErrorToast(
      createOptimisticConfig.forUpdate<OptimisticAITask, UpdateTaskRequest>({
        mutationFn: (input) => followApi.aiTask.update(input),
        queryKey: aiTaskKeys.list,
        getId: (variables) => variables.id,
        retryable: false,
      }),
    ),
  )
}

export const useDeleteAITaskMutation = () => {
  return useOptimisticMutation(
    withoutErrorToast(
      createOptimisticConfig.forDelete<OptimisticAITask, { id: string }>({
        mutationFn: ({ id }) => followApi.aiTask.delete({ id }),
        queryKey: aiTaskKeys.list,
        getId: (variables) => variables.id,
        retryable: false,
      }),
    ),
  )
}

export const useTestRunAITaskMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: aiTaskKeys.testRun,
    mutationFn: ({ id }: { id: string }) => followApi.aiTask.testRun({ id }, { timeout: 80000 }),
    onSuccess: async (_res, { id }) => {
      // Refresh task list and detail to reflect any updated run info
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiTaskKeys.list }),
        queryClient.invalidateQueries({ queryKey: aiTaskKeys.detail(id) }),
      ])
    },
  })
}
