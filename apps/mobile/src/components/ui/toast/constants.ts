import { CheckCircleFillIcon } from "@/src/icons/check_circle_fill"
import { CloseCircleFillIcon } from "@/src/icons/close_circle_fill"
import { InfoCircleFillIcon } from "@/src/icons/info_circle_fill"

export const toastTypeToIcons = {
  success: CheckCircleFillIcon,
  error: CloseCircleFillIcon,
  info: InfoCircleFillIcon,
} as const
