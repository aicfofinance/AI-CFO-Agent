import type { ReactNode } from "react";
import { AppNav } from "@/components/shared/AppNav";

type DashboardLayoutProps = {
  children: ReactNode;
};

export default function DashboardLayout({ children }: DashboardLayoutProps): React.JSX.Element {
  return (
    <div className="flex">
      <AppNav />
      <main className="flex-1 min-h-screen bg-surface-page p-8">{children}</main>
    </div>
  );
}
