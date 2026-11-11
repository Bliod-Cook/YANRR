import { cn } from "@follow/utils/utils"
import type { DragEvent, ReactNode } from "react"
import { useCallback, useRef, useState } from "react"

// Ported from https://github.com/react-dropzone/react-dropzone/issues/753#issuecomment-774782919
const useDragAndDrop = ({ callback }: { callback: (file: FileList) => void | Promise<void> }) => {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const onDrop = useCallback(
    async (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      // Reset also when the payload is not a file (e.g. dragged text), or the highlight would stick
      dragCounter.current = 0
      setIsDragging(false)
      if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        await callback(event.dataTransfer.files)
        event.dataTransfer.clearData()
      }
    },
    [callback],
  )

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault()
    dragCounter.current++
    setIsDragging(true)
  }, [])

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
  }, [])

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault()
    dragCounter.current--
    if (dragCounter.current > 0) return
    setIsDragging(false)
  }, [])

  return {
    isDragging,

    dragHandlers: {
      onDrop,
      onDragOver,
      onDragEnter,
      onDragLeave,
    },
  }
}

export interface DropZoneProps {
  id?: string
  accept?: string
  children?: ReactNode
  className?: string
  onDrop: (files: FileList) => void | Promise<void>
}

export const DropZone = ({ id, accept, children, className, onDrop }: DropZoneProps) => {
  const { isDragging, dragHandlers } = useDragAndDrop({ callback: onDrop })

  return (
    <label
      className={cn(
        "center flex h-[100px] w-full cursor-pointer rounded-md border border-dashed",
        isDragging ? "border-accent bg-accent/10" : "",
        "duration-200 hover:border-accent/50",
        className,
      )}
      htmlFor={id}
      {...dragHandlers}
    >
      {children}
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={async (e) => {
          const input = e.currentTarget
          if (!input.files) return
          try {
            await onDrop(input.files)
          } finally {
            // Let the same file be picked again
            input.value = ""
          }
        }}
        className="hidden"
      />
    </label>
  )
}
