import type { ImageSchema } from "@follow/database/schemas/types"
import { ImagesService } from "@follow/database/services/image"

import type { Hydratable } from "../../lib/base"
import { createImmerSetter, createTransaction, createZustandStore } from "../../lib/helper"

export type ImageModel = ImageSchema
type ImageStore = {
  images: Record<string, ImageModel>
}

const defaultState: ImageStore = {
  images: {},
}

export const useImagesStore = createZustandStore<ImageStore>("images")(() => defaultState)

const immerSet = createImmerSetter(useImagesStore)

class ImageActions implements Hydratable {
  async hydrate() {
    const images = await ImagesService.getImagesToHydrate()
    imageActions.upsertManyInSession(images)
  }

  upsertManyInSession(images: ImageModel[]) {
    immerSet((state) => {
      for (const image of images) {
        state.images[image.url] = image
      }
    })
  }

  async upsertMany(images: ImageModel[]) {
    const tx = createTransaction()
    tx.store(() => this.upsertManyInSession(images))
    tx.persist(() => ImagesService.upsertMany(images))
    await tx.run()
  }
}

export const imageActions = new ImageActions()
