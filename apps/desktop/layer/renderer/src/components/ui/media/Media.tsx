import { cn } from "@follow/utils/utils"
import type { FC, ImgHTMLAttributes, VideoHTMLAttributes } from "react"
import * as React from "react"
import { memo, use, useEffect, useState } from "react"
import { Blurhash, BlurhashCanvas } from "react-blurhash"
import { Trans, useTranslation } from "react-i18next"
import { useEventCallback } from "usehooks-ts"

import { useImageSrc } from "~/hooks/biz/useImageSrc"
import { saveImageDimensionsToDb } from "~/store/image/db"

import { ErrorBoundary } from "../../common/ErrorBoundary"
import { useMediaContainerWidth, usePreviewMedia } from "./hooks"
import { MediaInfoRecordContext } from "./MediaInfoRecordContext"
import type { VideoPlayerRef } from "./VideoPlayer"
import { VideoPlayer } from "./VideoPlayer"

type BaseProps = {
  mediaContainerClassName?: string
  showFallback?: boolean
  thumbnail?: boolean
  blurhash?: string
  inline?: boolean
  fitContent?: boolean
  fitContainer?: boolean
  videoClassName?: string
}

export type MediaProps = BaseProps &
  (
    | (ImgHTMLAttributes<HTMLImageElement> & {
        popper?: boolean
        type: "photo"
        previewImageUrl?: string
        cacheDimensions?: boolean
      })
    | (VideoHTMLAttributes<HTMLVideoElement> & {
        popper?: boolean
        type: "video"
        previewImageUrl?: string
      })
  )

const MediaImpl: FC<MediaProps> = ({
  className,
  popper = false,
  mediaContainerClassName,
  thumbnail,
  ...props
}) => {
  const {
    src,
    style,
    type,
    previewImageUrl,
    showFallback,
    blurhash,
    height,
    width,
    inline,
    fitContent,
    fitContainer,
    videoClassName,
    ...rest
  } = props

  const ctxMediaInfo = use(MediaInfoRecordContext)
  const ctxHeight = ctxMediaInfo[src!]?.height
  const ctxWidth = ctxMediaInfo[src!]?.width

  const finalHeight = height || ctxHeight
  const finalWidth = width || ctxWidth

  const [isError, setIsError] = useState(false)
  const [mediaLoadState, setMediaLoadState] = useState<"loading" | "loaded">("loading")
  // The original `src` keeps naming the photo: for its size, preview and fallback link
  const photo = useImageSrc(type === "photo" ? src : undefined)

  const errorHandle: React.ReactEventHandler<HTMLImageElement> = useEventCallback((e) => {
    if (photo.fallBack()) return
    setIsError(true)

    if (import.meta.env.DEV) {
      console.error(`[Media Error] Failed to load image: ${src}`, e)
    }
  })

  const previewMedia = usePreviewMedia()
  const handleClick = useEventCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (popper && src) {
      const width = Number.parseInt(props.width as string)
      const height = Number.parseInt(props.height as string)
      previewMedia(
        [
          {
            url: src,
            type,
            blurhash: props.blurhash,
            width: width || undefined,
            height: height || undefined,
          },
        ],
        0,
      )
    }
    props.onClick?.(e as any)
  })
  const handleOnLoad: React.ReactEventHandler<HTMLImageElement> = useEventCallback((e) => {
    setMediaLoadState("loaded")
    rest.onLoad?.(e as any)

    if (import.meta.env.DEV) {
      console.info(`[Media Success] Image loaded successfully`, {
        src,
        dimensions: {
          width: e.currentTarget.naturalWidth,
          height: e.currentTarget.naturalHeight,
          ratio: e.currentTarget.naturalWidth / e.currentTarget.naturalHeight,
        },
        loadTime: performance.now(),
      })
    }

    if ("cacheDimensions" in props && props.cacheDimensions && src) {
      saveImageDimensionsToDb(src, {
        src,
        width: e.currentTarget.naturalWidth,
        height: e.currentTarget.naturalHeight,
        ratio: e.currentTarget.naturalWidth / e.currentTarget.naturalHeight,
        blurhash: props.blurhash,
      })
    }
  })

  const containerWidth = useMediaContainerWidth()

  const renderInnerContent = () => {
    switch (type) {
      case "photo": {
        // @ts-expect-error
        const { cacheDimensions, ...props } = rest
        return (
          <img
            height={finalHeight}
            width={finalWidth}
            // Decodes off the main thread, so a large photo does not hold up scrolling
            decoding="async"
            {...(props as ImgHTMLAttributes<HTMLImageElement>)}
            onError={errorHandle}
            className={cn(
              "size-full object-contain",
              inline && "inline size-auto align-sub",
              popper && "cursor-zoom-in",
              "duration-200",
              mediaLoadState === "loaded" ? "opacity-100" : "opacity-0",
              "!my-0",
              mediaContainerClassName,
            )}
            src={photo.src}
            onLoad={handleOnLoad}
            onClick={handleClick}
          />
        )
      }
      case "video": {
        return (
          <span
            className={cn(
              "center",
              !(finalWidth || finalHeight) && "size-full",
              "relative cursor-card object-cover",
              mediaContainerClassName,
            )}
            onClick={handleClick}
          >
            <VideoPreview
              src={src!}
              previewImageUrl={previewImageUrl}
              thumbnail={thumbnail}
              videoClassName={videoClassName}
            />
          </span>
        )
      }
      default: {
        return null
      }
    }
  }
  const InnerContent = renderInnerContent()

  if (!type || !src) return null

  if (isError) {
    if (showFallback) {
      return (
        <FallbackMedia
          mediaContainerClassName={mediaContainerClassName}
          className={className}
          style={style}
          {...props}
        />
      )
    } else {
      return (
        <div
          className={cn("relative overflow-hidden rounded", className)}
          data-state={mediaLoadState}
          style={props.style}
        >
          <span
            className={cn(
              "relative inline-block max-w-full bg-material-ultra-thick",
              mediaContainerClassName,
            )}
            style={{
              aspectRatio:
                props.height && props.width ? `${props.width} / ${props.height}` : undefined,
              width: props.width ? `${props.width}px` : "100%",
            }}
          >
            {props.blurhash && (
              <ErrorBoundary>
                <span
                  className={cn(
                    "absolute inset-0 overflow-hidden rounded",
                    mediaLoadState === "loaded" && "animate-out fade-out-0 fill-mode-forwards",
                  )}
                >
                  <BlurhashCanvas hash={props.blurhash} className="size-full" />
                </span>
              </ErrorBoundary>
            )}
          </span>
        </div>
      )
    }
  }

  return (
    <span
      data-state={type !== "video" ? mediaLoadState : undefined}
      data-media-debug={
        import.meta.env.DEV
          ? JSON.stringify({
              src,
              isError,
              mediaLoadState,
            })
          : undefined
      }
      className={cn("relative overflow-hidden rounded", inline ? "inline" : "block", className)}
      style={style}
    >
      {!!props.width && !!props.height && !!containerWidth ? (
        <AspectRatio
          width={Number.parseInt(props.width as string)}
          height={Number.parseInt(props.height as string)}
          containerWidth={containerWidth}
          fitContent={fitContent}
          fitContainer={fitContainer}
        >
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center overflow-hidden rounded",
              mediaLoadState === "loaded" && "animate-out fade-out-0 fill-mode-forwards",
            )}
            data-blurhash={blurhash}
          >
            {blurhash ? (
              <Blurhash hash={blurhash} width="100%" height="100%" />
            ) : (
              <div className="size-full bg-border" />
            )}
          </div>
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded">
            {InnerContent}
          </div>
        </AspectRatio>
      ) : (
        InnerContent
      )}
    </span>
  )
}

export const Media: FC<MediaProps> = memo((props) => <MediaImpl {...props} key={props.src} />)

const FallbackMedia: FC<MediaProps> = ({ type, mediaContainerClassName, className, ...props }) => {
  const { t } = useTranslation()
  return (
    <div className={className} style={props.style}>
      <div
        className={cn(
          "size-full",
          "center rounded bg-material-ultra-thick",
          "not-prose @container !flex max-h-full flex-col space-y-1 p-4",
          mediaContainerClassName,
        )}
      >
        <div className="@sm:hidden @md:contents hidden">
          <i className="i-mgc-close-cute-re text-xl text-red" />
          <p>{t("media.load_failed")}</p>
          <div className="space-x-1 break-all px-4 text-sm">
            <Trans
              t={t}
              i18nKey="media.open_original"
              components={{
                Link: (
                  <a
                    href={props.src}
                    target="_blank"
                    rel="noreferrer"
                    className="follow-link--underline"
                  />
                ),
              }}
            />
            <i className="i-mgc-external-link-cute-re translate-y-0.5" />
          </div>
        </div>
      </div>
    </div>
  )
}

const AspectRatio = ({
  width,
  height,
  containerWidth,
  children,
  style,
  fitContent,
  fitContainer,
  ...props
}: {
  width: number
  height: number
  containerWidth?: number
  children: React.ReactNode
  style?: React.CSSProperties
  /**
   * If `fit` is true, the content width may be increased to fit the container width
   */
  fitContent?: boolean
  fitContainer?: boolean
  [key: string]: any
}) => {
  const scaleFactor =
    containerWidth && width
      ? fitContent
        ? containerWidth / width
        : Math.min(1, containerWidth / width)
      : 1

  const scaledWidth = width ? width * scaleFactor : undefined
  const scaledHeight = height ? height * scaleFactor : undefined

  return (
    <div
      style={{
        position: "relative",
        width: fitContainer ? "100%" : scaledWidth ? `${scaledWidth}px` : "100%",
        height: fitContainer ? "100%" : scaledHeight ? `${scaledHeight}px` : "auto",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

const VideoPreview: FC<{
  src: string
  previewImageUrl?: string
  thumbnail?: boolean
  videoClassName?: string
}> = ({ src, previewImageUrl, thumbnail = false, videoClassName }) => {
  const [isInitVideoPlayer, setIsInitVideoPlayer] = useState(!previewImageUrl)
  const [hovered, setHovered] = useState(false)
  const [isPaused, setIsPaused] = useState(true)
  const [videoRef, setVideoRef] = useState<VideoPlayerRef | null>(null)
  const poster = useImageSrc(previewImageUrl)

  // The player mounts on the first hover, so playback follows the state, not the mouse event
  useEffect(() => {
    if (!videoRef) return
    if (hovered) {
      videoRef.controls.play()
    } else {
      videoRef.controls.pause()
    }
  }, [hovered, videoRef])

  return (
    <div
      className="size-full"
      onMouseEnter={() => {
        setIsInitVideoPlayer(true)
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {!isInitVideoPlayer ? (
        <img
          src={poster.src}
          onError={poster.fallBack}
          className={cn("size-full object-cover", videoClassName)}
        />
      ) : (
        <VideoPlayer
          variant={thumbnail ? "thumbnail" : "preview"}
          controls={false}
          src={src}
          poster={poster.src}
          ref={setVideoRef}
          muted
          onPlay={() => setIsPaused(false)}
          onPause={() => setIsPaused(true)}
          className={cn("not-prose relative size-full object-cover", videoClassName)}
        />
      )}

      <div
        className={cn(
          "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-3xl text-white/80 duration-200",
          isPaused ? "opacity-100" : "opacity-0",
        )}
      >
        <i className="i-mgc-play-cute-fi" />
      </div>
    </div>
  )
}
