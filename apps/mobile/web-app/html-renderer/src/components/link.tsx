import { timeStringToSeconds } from "@follow/utils/utils"
import { useAtomValue } from "jotai"

import { entryAtom } from "~/atoms"

export interface LinkProps {
  href?: string
  title?: string
  children?: React.ReactNode
}

export const MarkdownLink = ({ href, title, children }: LinkProps) => {
  const hasAudio = useAtomValue(entryAtom)?.attachments?.some((attachment) =>
    attachment.mime_type?.startsWith("audio/"),
  )
  const time = hasAudio && typeof children === "string" ? timeStringToSeconds(children) : null

  if (time !== null) {
    return (
      <button
        className="text-accent underline"
        onClick={() => bridge.seekAudio(time)}
        type="button"
      >
        {children}
      </button>
    )
  }

  return (
    <a
      draggable="false"
      className="font-semibold text-text no-underline"
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
    >
      {children}

      {typeof children === "string" && (
        <i className="i-mgc-arrow-right-up-cute-re size-[0.9em] translate-y-[2px] opacity-70" />
      )}
    </a>
  )
}
