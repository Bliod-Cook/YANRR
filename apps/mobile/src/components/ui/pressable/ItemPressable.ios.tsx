import { cn } from "@follow/utils"
import type { FC } from "react"
import { memo } from "react"

import { ItemPressableStyle } from "./enum"
import { NativeItemPressable } from "./IosItemPressable"
import type { ItemPressableProps } from "./ItemPressable.types"

export const ItemPressable: FC<ItemPressableProps> = memo(
  ({ children, itemStyle = ItemPressableStyle.Grouped, className, ...props }) => {
    const isUnStyled = itemStyle === ItemPressableStyle.UnStyled
    return (
      <NativeItemPressable
        {...props}
        className={
          isUnStyled
            ? className
            : cn(
                "relative overflow-hidden",

                itemStyle === ItemPressableStyle.Plain
                  ? "bg-system-background"
                  : "bg-secondary-system-grouped-background",
                className,
              )
        }
        touchHighlight={props.touchHighlight ?? true}
        onItemPress={() => {
          props.onPress?.()
        }}
      >
        {children}
      </NativeItemPressable>
    )
  },
)
