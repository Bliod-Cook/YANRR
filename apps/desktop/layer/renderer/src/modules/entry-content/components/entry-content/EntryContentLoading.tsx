import { Avatar, AvatarImage } from "@follow/components/ui/avatar/index.jsx"
import { LoadingCircle, LoadingWithIcon } from "@follow/components/ui/loading/index.jsx"
import { env } from "@follow/shared/env.desktop"
import { getSiteIconUrl } from "@follow/utils/server-url"

export const EntryContentLoading = (props: { icon?: string | null }) => {
  if (!props.icon) {
    return <LoadingWithIcon size="large" icon={<i className="i-mgc-docment-cute-re" />} />
  }
  return (
    <div className="center mb-14 flex flex-col gap-4">
      <Avatar className="animate-pulse rounded-sm">
        <AvatarImage src={getSiteIconUrl(env.VITE_API_URL, props.icon)} />
      </Avatar>
      <LoadingCircle size="medium" />
    </div>
  )
}
