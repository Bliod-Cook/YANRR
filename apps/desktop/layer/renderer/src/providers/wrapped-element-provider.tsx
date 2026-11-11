import { cn } from "@follow/utils/utils"
import { createContextState } from "foxact/create-context-state"
import { useIsomorphicLayoutEffect } from "foxact/use-isomorphic-layout-effect"
import { memo } from "react"

import { ProviderComposer } from "~/components/common/ProviderComposer"

const [WrappedElementProviderInternal, useWrappedElement, useSetWrappedElement] =
  createContextState<HTMLDivElement | null>(undefined as any)

const [ElementSizeProviderInternal, useWrappedElementSize, useSetWrappedElementSize] =
  createContextState({
    h: 0,
    w: 0,
  })

const Providers = [
  <WrappedElementProviderInternal key="ArticleElementProviderInternal" />,
  <ElementSizeProviderInternal key="ElementSizeProviderInternal" />,
]

interface WrappedElementProviderProps {
  as?: keyof React.JSX.IntrinsicElements
}

export const WrappedElementProvider: Component<WrappedElementProviderProps> = ({
  children,
  className,
  ...props
}) => (
  <ProviderComposer contexts={Providers}>
    <ArticleElementResizeObserver />
    <Content {...props} className={className}>
      {children}
    </Content>
  </ProviderComposer>
)
const ArticleElementResizeObserver = () => {
  const setSize = useSetWrappedElementSize()
  const $element = useWrappedElement()
  useIsomorphicLayoutEffect(() => {
    if (!$element) return
    const { height, width } = $element.getBoundingClientRect()
    setSize({ h: height, w: width })

    const observer = new ResizeObserver((entries) => {
      const { height, width } = entries[0]!.contentRect
      setSize({ h: height, w: width })
    })
    observer.observe($element)
    return () => {
      observer.disconnect()
    }
  }, [$element])

  return null
}

const Content: Component<WrappedElementProviderProps> = memo(
  ({ children, className, as = "div" }) => {
    const setElement = useSetWrappedElement()

    const As = as as any
    return (
      <As className={cn("relative", className)} ref={setElement}>
        {children}
      </As>
    )
  },
)

Content.displayName = "ArticleElementProviderContent"

export { useWrappedElement, useWrappedElementSize }
