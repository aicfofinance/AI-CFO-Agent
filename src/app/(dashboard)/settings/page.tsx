import { redirect } from "next/navigation";

/**
 * /settings — immediately redirects to /settings/connections.
 * The settings section layout renders the sub-page content; there is no
 * meaningful content to show at the bare /settings path itself.
 */
export default function SettingsPage(): never {
  redirect("/settings/connections");
}
