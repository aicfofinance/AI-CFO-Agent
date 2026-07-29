import type { ReactNode } from "react";
import { AppNavServer } from "@/components/shared/AppNavServer";

type DashboardLayoutProps = {
  children: ReactNode;
};

export default function DashboardLayout({ children }: DashboardLayoutProps): React.JSX.Element {
  return (
    <div className="flex">
      <AppNavServer />
      <main className="flex-1 min-h-screen bg-surface-page p-8">{children}</main>
    </div>
  );
}
