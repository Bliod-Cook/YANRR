import { redirect } from "react-router"

import { ROUTE_ENTRY_PENDING } from "~/constants"

export const Component = () => {
  return null
}
export const loader = ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  return redirect(`${url.pathname}/${ROUTE_ENTRY_PENDING}`)
}
