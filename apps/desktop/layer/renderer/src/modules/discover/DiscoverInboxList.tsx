import { Button } from "@follow/components/ui/button/index.js"
import { useTranslation } from "react-i18next"

import { useModalStack } from "~/components/ui/modal/stacked/hooks"

import { InboxTable } from "./Inbox"
import { InboxForm } from "./InboxForm"

export function DiscoverInboxList() {
  const { t } = useTranslation()

  const { present } = useModalStack()

  return (
    <div className="mx-auto w-full">
      <div className="mb-4 text-sm text-zinc-500">{t("discover.inbox.description")}</div>
      <InboxTable />
      <div className="center mt-4 flex">
        {/* New Inbox */}
        <Button
          textClassName="flex items-center gap-2"
          onClick={() =>
            present({
              title: t("sidebar.feed_actions.new_inbox"),
              content: () => <InboxForm asWidget />,
            })
          }
        >
          <i className="i-mingcute-add-line" />
          {t("discover.inbox_create")}
        </Button>
      </div>
    </div>
  )
}
