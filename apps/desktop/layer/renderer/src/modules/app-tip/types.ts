export type AppTipStep = {
  id: string
  title: string
  description: string
  highlights: string[]
  media: React.ReactNode
  primaryActionLabel: string
  onPrimaryAction: () => void
}
