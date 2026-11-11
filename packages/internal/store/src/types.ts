export type GeneralMutationOptions = {
  onSuccess?: () => void
  onError?: (errorMessage: Error) => void
}

export type GeneralQueryOptions = {
  enabled?: boolean
}
