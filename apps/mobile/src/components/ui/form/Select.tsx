import { cn } from "@follow/utils"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { View } from "react-native"
import * as DropdownMenu from "zeego/dropdown-menu"

import { Text } from "@/src/components/ui/typography/Text"
import { MingcuteDownLineIcon } from "@/src/icons/mingcute_down_line"
import { accentColor, useColor } from "@/src/theme/colors"

import { FormLabel } from "./Label"
import type { SelectProps } from "./Select.types"

export function Select<T>({
  options,
  value,
  onValueChange,
  displayValue,
  wrapperClassName,
  wrapperStyle,
  label,
  disabled,
}: SelectProps<T>) {
  const { t } = useTranslation()
  const valueToLabelMap = useMemo(() => {
    return options.reduce((acc, option) => {
      acc.set(option.value, option.label)
      return acc
    }, new Map<T, string>())
  }, [options])
  const grayColor = useColor("gray")
  const Trigger = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <View
          // grow rather than flex-1: the menu wraps it in a view without a set height, where Yoga
          // kept the zero flex basis of flex-1 once the window resized and the value disappeared
          className={cn(
            "min-w-24 shrink grow flex-row items-center rounded-lg pl-3",
            disabled && "opacity-50",
            wrapperClassName,
          )}
          style={wrapperStyle}
        >
          <Text
            className={cn("flex-1 text-right font-semibold text-accent", disabled && "text-gray")}
            ellipsizeMode="tail"
            numberOfLines={1}
          >
            {displayValue || valueToLabelMap.get(value) || t("select.placeholder")}
          </Text>
          <View className="ml-auto shrink-0 pl-1">
            <MingcuteDownLineIcon
              color={disabled ? grayColor : accentColor}
              height={18}
              width={18}
            />
          </View>
        </View>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content>
        {options.map((option) => {
          return (
            <DropdownMenu.CheckboxItem
              key={option.label}
              value={value === option.value}
              onSelect={() => onValueChange(option.value)}
            >
              <DropdownMenu.ItemTitle>{option.label}</DropdownMenu.ItemTitle>
              {!!option.subLabel && (
                <DropdownMenu.ItemSubtitle>{option.subLabel}</DropdownMenu.ItemSubtitle>
              )}
            </DropdownMenu.CheckboxItem>
          )
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
  if (!label) {
    return Trigger
  }
  return (
    <View className="flex-1 flex-row items-center justify-between">
      <FormLabel className="pl-2" label={label} />
      <View className="flex-1">{Trigger}</View>
    </View>
  )
}
