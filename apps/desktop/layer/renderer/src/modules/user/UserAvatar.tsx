import { Avatar, AvatarFallback, AvatarImage } from "@follow/components/ui/avatar/index.jsx"
import { useWhoami } from "@follow/store/user/hooks"
import { getColorScheme, stringToHue } from "@follow/utils/color"
import { cn } from "@follow/utils/utils"

export const UserAvatar = ({
  ref,
  className,
  avatarClassName,
  hideName,
  style,
  ...props
}: {
  className?: string
  avatarClassName?: string
  hideName?: boolean
} & React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement | null> }) => {
  const whoami = useWhoami()
  const randomColor = stringToHue(whoami?.name || "")
  return (
    <div
      style={style}
      ref={ref}
      {...props}
      className={cn(
        "relative flex h-20 items-center justify-center gap-2 px-5 py-2 font-medium text-text-secondary",
        className,
      )}
    >
      <Avatar
        className={cn(
          "aspect-square h-full w-auto overflow-hidden rounded-full border bg-stone-300",
          avatarClassName,
        )}
      >
        <AvatarImage
          className="duration-200 animate-in fade-in-0"
          src={whoami?.image || undefined}
        />
        <AvatarFallback
          style={{ backgroundColor: getColorScheme(randomColor, true).light.accent }}
          className="text-xs text-white"
        >
          {whoami?.name?.[0]}
        </AvatarFallback>
      </Avatar>
      {!hideName && <div>{whoami?.name}</div>}
    </div>
  )
}

UserAvatar.displayName = "UserAvatar"
