export interface ToastProps {
  id: number
  type: "success" | "error" | "info"
  message: string
  /** A second line under the message, such as the reason a request failed */
  description?: string
  duration: number
  icon?: React.ReactNode | false
}
