import { shareImage, useSaveImageToMediaLibrary } from "../image/utils"
import ImageView from "./ImageViewing"
import { useLightbox, useLightboxControls } from "./lightboxState"

export function Lightbox() {
  const { activeLightbox } = useLightbox()
  const { closeLightbox } = useLightboxControls()

  const saveImageToAlbum = useSaveImageToMediaLibrary()

  return (
    <ImageView
      lightbox={activeLightbox}
      onRequestClose={closeLightbox}
      onPressSave={saveImageToAlbum}
      onPressShare={shareImage}
    />
  )
}
