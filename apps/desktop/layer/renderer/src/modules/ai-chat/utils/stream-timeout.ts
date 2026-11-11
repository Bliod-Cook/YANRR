// `cancel` runs when the readable side is cancelled or the writable side aborted; lib.dom does
// not declare it yet.
type CancelableTransformer<I, O> = Transformer<I, O> & {
  cancel?: (reason: unknown) => void
}

/**
 * Errors the stream when nothing arrives for `timeout` ms. Unlike an abort, which the AI SDK
 * treats as the user stopping the reply, an error puts the chat in its error state.
 */
export const withInactivityTimeout = <T>(
  stream: ReadableStream<T>,
  timeout: number,
  createError: () => Error,
): ReadableStream<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  const restart = (controller: TransformStreamDefaultController<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.error(createError()), timeout)
  }

  const transformer: CancelableTransformer<T, T> = {
    start(controller) {
      restart(controller)
    },
    transform(chunk, controller) {
      restart(controller)
      controller.enqueue(chunk)
    },
    flush() {
      clearTimeout(timer)
    },
    cancel() {
      clearTimeout(timer)
    },
  }

  return stream.pipeThrough(new TransformStream<T, T>(transformer))
}
