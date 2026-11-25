import { Input } from "@follow/components/ui/input/index.js"
import { RootPortal } from "@follow/components/ui/portal/index.jsx"
import { useCorrectZIndex } from "@follow/components/ui/z-index/ctx.js"
import { stopPropagation } from "@follow/utils/dom"
import { cn } from "@follow/utils/utils"
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react"
import Fuse from "fuse.js"
import { AnimatePresence, m } from "motion/react"
import { Fragment, memo, useMemo, useState } from "react"

export type Suggestion = {
  name: string
  value: string
}
export interface AutocompleteProps extends React.InputHTMLAttributes<HTMLInputElement> {
  suggestions: Suggestion[]
  renderSuggestion?: (suggestion: Suggestion) => any

  onSuggestionSelected: (suggestion: NoInfer<Suggestion> | null) => void

  // classnames

  searchKeys?: string[]
  maxHeight?: number
}

const defaultSearchKeys = ["name", "value"]
const defaultRenderSuggestion = (suggestion: any) => suggestion?.name
export const Autocomplete = ({
  ref: forwardedRef,
  suggestions,
  renderSuggestion = defaultRenderSuggestion,
  onSuggestionSelected,
  maxHeight,
  value,
  searchKeys = defaultSearchKeys,
  defaultValue,
  ...inputProps
}: AutocompleteProps & { ref?: React.Ref<HTMLInputElement | null> }) => {
  const [selectedOptions, setSelectedOptions] = useState<NoInfer<Suggestion> | null>(
    () => suggestions.find((suggestion) => suggestion.value === value) || null,
  )

  const filterableSuggestions = useMemo(() => {
    const trimInputValue = (value as string)?.trim()
    if (!trimInputValue) return suggestions

    return new Fuse(suggestions, { keys: searchKeys })
      .search(trimInputValue)
      .map((result) => result.item)
  }, [suggestions, value, searchKeys])

  const zIndex = useCorrectZIndex(9)
  return (
    <Combobox
      as="div"
      immediate
      value={selectedOptions}
      onChange={(suggestion) => {
        setSelectedOptions(suggestion)
        onSuggestionSelected(suggestion)
      }}
    >
      {({ open }) => {
        return (
          <Fragment>
            <ComboboxInput
              ref={forwardedRef}
              as={Input}
              autoComplete="off"
              displayValue={renderSuggestion}
              value={value}
              {...inputProps}
            />
            <AnimatePresence>
              {open && filterableSuggestions.length > 0 && (
                <RootPortal>
                  <ComboboxOptions
                    portal
                    static
                    as={m.div}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    anchor="bottom"
                    style={{ zIndex }}
                    onWheel={stopPropagation}
                    className={cn(
                      "pointer-events-auto bg-material-medium text-text backdrop-blur-background",
                      "min-w-32 overflow-hidden rounded-[6px] border p-1 shadow-context-menu",
                      "motion-scale-in-75 text-body motion-duration-150 lg:animate-none",
                      "w-[var(--input-width)] empty:invisible",
                    )}
                  >
                    <div style={{ maxHeight }}>
                      {filterableSuggestions.map((suggestion) => (
                        <MemoizedComboboxOption key={suggestion.value} suggestion={suggestion} />
                      ))}
                    </div>
                  </ComboboxOptions>
                </RootPortal>
              )}
            </AnimatePresence>
          </Fragment>
        )
      }}
    </Combobox>
  )
}

const MemoizedComboboxOption = memo(({ suggestion }: { suggestion: Suggestion }) => {
  return (
    <ComboboxOption
      key={suggestion.value}
      value={suggestion}
      className={cn(
        "cursor-menu focus:bg-theme-selection-active focus:text-theme-selection-foreground",
        "data-[focus]:bg-theme-selection-hover data-[focus]:text-theme-selection-foreground",
        "relative flex items-center rounded-[5px] px-2.5 py-1.5 outline-none select-none",
        "h-[28px]",
      )}
    >
      {suggestion.name}
    </ComboboxOption>
  )
})

Autocomplete.displayName = "Autocomplete"
