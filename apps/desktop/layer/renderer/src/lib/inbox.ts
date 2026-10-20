import { env } from "@follow/shared/env.desktop"

/** Inboxes receive mail at the domain of the server. */
export const INBOX_EMAIL_DOMAIN = `@${new URL(env.VITE_WEB_URL).hostname}`
