import type { PropsWithChildren, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Pressable } from "react-native"

import { ContextMenu } from "../context-menu"
import { shareImage, useSaveImageToMediaLibrary } from "./utils"

type ImageContextMenuProps = PropsWithChildren<{
  imageUrl?: string
  /** Menu items of the entry the image belongs to, shown above the image's own */
  entryActions?: ReactNode
}>

export const ImageContextMenu = ({ imageUrl, entryActions, children }: ImageContextMenuProps) => {
  const { t } = useTranslation()
  const saveImageToAlbum = useSaveImageToMediaLibrary()

  if (!imageUrl) {
    return children
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Pressable>{children}</Pressable>
      </ContextMenu.Trigger>

      <ContextMenu.Content>
        {entryActions}

        <ContextMenu.Item key="Save" onSelect={() => saveImageToAlbum(imageUrl)}>
          <ContextMenu.ItemTitle>{t("image.save_to_album")}</ContextMenu.ItemTitle>
          <ContextMenu.ItemIcon
            ios={{
              name: "square.and.arrow.down",
            }}
          />
        </ContextMenu.Item>
        <ContextMenu.Item key="Share" onSelect={() => shareImage(imageUrl)}>
          <ContextMenu.ItemIcon
            ios={{
              name: "square.and.arrow.up",
            }}
          />
          <ContextMenu.ItemTitle>{t("operation.share")}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  )
}
