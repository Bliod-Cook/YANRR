import type { UniqueIdentifier } from "@dnd-kit/core"
import { DragOverlay, useDndContext } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { RootPortal } from "@follow/components/ui/portal/index.js"
import { cn } from "@follow/utils/utils"
import type { ReactNode } from "react"
import { useMemo } from "react"

import { getCommand } from "../command/hooks/use-command"
import type { FollowCommandId } from "../command/types"

const ActionButton = ({ id, className }: { id: UniqueIdentifier; className: string }) => {
  const cmd = getCommand(id as FollowCommandId)
  if (!cmd) return null
  return (
    <div className={cn("flex flex-col items-center rounded-lg p-2", className)}>
      <div className="flex size-8 items-center justify-center text-xl">
        {typeof cmd.icon === "function" ? cmd.icon({ isActive: false }) : cmd.icon}
      </div>
      <div className="mt-1 text-center text-callout text-text-secondary">{cmd.label.title}</div>
    </div>
  )
}

export const SortableActionButton = ({ id }: { id: UniqueIdentifier }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => true, // Enable layout animations
    transition: {
      duration: 400,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    },
  })

  const style = useMemo(
    () => ({ transform: CSS.Transform.toString(transform), transition }),
    [transform, transition],
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "h-[80px] w-[100px] cursor-grab transition-colors duration-200",
        isDragging && "opacity-30",
      )}
      {...attributes}
      {...listeners}
    >
      <ActionButton id={id} className="hover:bg-material-opaque" />
    </div>
  )
}

/**
 * Follows the pointer while an action is dragged, also over the other area, where the dragged
 * item itself stays in place until the drop moves it.
 */
export const ActionDragOverlay = () => {
  const { active } = useDndContext()

  // The modal is transformed and clips its content, so the overlay goes to the modal's root
  return (
    <RootPortal>
      <DragOverlay>
        {active && (
          <div className="h-[80px] w-[100px] cursor-grabbing">
            <ActionButton id={active.id} className="bg-material-opaque" />
          </div>
        )}
      </DragOverlay>
    </RootPortal>
  )
}

export function DroppableContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[120px] w-full flex-wrap items-center justify-center rounded-lg border border-border bg-material-ultra-thin p-2 shadow-sm">
      {children}
    </div>
  )
}
