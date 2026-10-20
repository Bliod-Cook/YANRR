import type { PropsWithChildren, ReactNode } from "react"
import { createElement } from "react"
import type { FallbackProps } from "react-error-boundary"
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary"

export type ErrorFallbackProps = Omit<FallbackProps, "resetErrorBoundary"> &
  FallbackProps & {
    resetError: () => void
  }
export type FallbackRender = (props: ErrorFallbackProps) => ReactNode

interface ErrorBoundaryProps extends PropsWithChildren {
  fallback?: FallbackRender
  fallbackRender?: FallbackRender
  handled?: boolean
}

const emptyFallback: FallbackRender = () => null

export const ErrorBoundary = ({ children, fallback, fallbackRender }: ErrorBoundaryProps) => {
  const renderFallback = fallbackRender ?? fallback ?? emptyFallback

  return (
    <ReactErrorBoundary
      // Render the fallback as a component so it can use hooks (e.g. useTranslation)
      fallbackRender={(props) =>
        createElement(renderFallback, {
          ...props,
          resetError: props.resetErrorBoundary,
        })
      }
    >
      {children}
    </ReactErrorBoundary>
  )
}
