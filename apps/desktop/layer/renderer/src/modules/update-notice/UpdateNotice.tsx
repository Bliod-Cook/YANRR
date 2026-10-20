import { Spring } from "@follow/components/constants/spring.js"
import { cn } from "@follow/utils/utils"
import { m } from "motion/react"
import { useTranslation } from "react-i18next"

import { useAudioPlayerAtomSelector } from "~/atoms/player"
import { setPwaUpdate, usePwaUpdate } from "~/atoms/pwa-update"

export const UpdateNotice = () => {
  const pwaUpdate = usePwaUpdate()
  const { t } = useTranslation()
  const playerIsShow = useAudioPlayerAtomSelector((s) => s.show)

  if (!pwaUpdate) return null

  const handleClick = () => {
    pwaUpdate.finishUpdate()
    setPwaUpdate(null)
  }

  return (
    <m.div
      className={cn(
        "group absolute inset-x-3 cursor-pointer",
        playerIsShow ? "bottom-[4.5rem]" : "bottom-3",
      )}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleClick()
        }
      }}
      initial={{ y: 20, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 20, opacity: 0, scale: 0.95 }}
      transition={Spring.presets.smooth}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Glassmorphic container */}
      <div
        className="relative overflow-hidden rounded-xl bg-background"
        style={{
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgba(255, 92, 0, 0.2)",
          boxShadow:
            "0 8px 32px rgba(255, 92, 0, 0.08), 0 4px 16px rgba(255, 92, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.1)",
        }}
      >
        {/* Inner glow layer */}
        <div
          className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              "linear-gradient(to bottom right, rgba(255, 92, 0, 0.05), transparent, rgba(255, 92, 0, 0.05))",
          }}
        />

        {/* Animated shine effect */}
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-gray/5 to-transparent transition-transform duration-700 group-hover:translate-x-full dark:via-white/5" />

        {/* Content */}
        <div className="relative flex items-center gap-3 px-4 py-2.5">
          {/* Animated icon */}
          <m.div
            className="flex-shrink-0"
            initial={{ rotate: -10 }}
            animate={{ rotate: 0 }}
            transition={{ ...Spring.presets.bouncy, delay: 0.1 }}
          >
            <div className="relative flex size-9 items-center justify-center">
              {/* Icon */}
              <div className="relative flex items-center justify-center">
                <i className="i-mgc-download-2-cute-re size-6 text-orange" />
              </div>
            </div>
          </m.div>

          {/* Text content */}
          <div className="min-w-0 flex-1 text-left">
            <m.div
              className="text-sm font-medium text-text"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ ...Spring.presets.smooth, delay: 0.15 }}
            >
              {t("notify.update_info", { app_name: APP_NAME })}
            </m.div>
            <m.div
              className="mt-0.5 text-xs text-text-tertiary"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ ...Spring.presets.smooth, delay: 0.2 }}
            >
              {t("notify.update_info_3")}
            </m.div>
          </div>
        </div>
      </div>
    </m.div>
  )
}
