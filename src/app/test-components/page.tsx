"use client";

/**
 * Test page for Step 7.1 DoD: "All components render without errors."
 * Primary button background must match #2557A7 (primary-500).
 *
 * This page is for development verification only and is NOT linked from the
 * main navigation.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { MetricChange } from "@/components/shared/MetricChange";
import { AlertBadge } from "@/components/shared/AlertBadge";
import { MetricCardSkeleton } from "@/components/shared/MetricCardSkeleton";
import { FinancialTable, type ColumnDef } from "@/components/shared/FinancialTable";
import { DataTimestamp } from "@/components/shared/DataTimestamp";
import { FindingCardSkeleton } from "@/components/dashboard/FindingCardSkeleton";
import { AIResponseSkeleton } from "@/components/chat/AIResponseSkeleton";

type DemoRow = {
  category: string;
  amount: string;
  change: number;
};

const TABLE_COLUMNS: ColumnDef<DemoRow>[] = [
  { key: "category", header: "Category" },
  {
    key: "amount",
    header: "Amount",
    numeric: true,
    render: (value) => <CurrencyAmount value={value as string} />,
  },
  {
    key: "change",
    header: "Change",
    numeric: true,
    render: (value) => <MetricChange value={value as number} />,
  },
];

const TABLE_DATA: DemoRow[] = [
  { category: "Revenue", amount: "145200.00", change: 12.3 },
  { category: "Expenses", amount: "-89300.00", change: -5.2 },
  { category: "Net Profit", amount: "55900.00", change: 0 },
  { category: "Missing", amount: "", change: 0 },
];

export default function TestComponentsPage(): React.JSX.Element {
  const staleDate = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();
  const freshDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-8">
      <h1 className="text-3xl font-semibold text-gray-900">Component test page</h1>

      {/* ── Buttons ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Button (primary color = #2557A7)</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </section>

      <Separator />

      {/* ── Input ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Input</h2>
        <Input placeholder="Enter text…" className="max-w-xs" />
      </section>

      <Separator />

      {/* ── Select ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Select</h2>
        <Select>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder="Choose an option…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quickbooks">QuickBooks Online</SelectItem>
            <SelectItem value="xero">Xero</SelectItem>
            <SelectItem value="csv">CSV Upload</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <Separator />

      {/* ── Dialog ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Dialog</h2>
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test dialog</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-600">Dialog content renders here.</p>
          </DialogContent>
        </Dialog>
      </section>

      <Separator />

      {/* ── Tooltip ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Tooltip</h2>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="outline">Hover for tooltip</Button>
          </TooltipTrigger>
          <TooltipContent>Tooltip content</TooltipContent>
        </Tooltip>
      </section>

      <Separator />

      {/* ── Skeleton (shadcn) ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Skeleton (shadcn)</h2>
        <Skeleton className="h-6 w-48" />
      </section>

      <Separator />

      {/* ── Badge ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Badge</h2>
        <div className="flex gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </section>

      <Separator />

      {/* ── Tabs ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Tabs</h2>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="detail">Detail</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p className="mt-2 text-sm text-gray-600">Overview tab content.</p>
          </TabsContent>
          <TabsContent value="detail">
            <p className="mt-2 text-sm text-gray-600">Detail tab content.</p>
          </TabsContent>
        </Tabs>
      </section>

      <Separator />

      {/* ── SeverityBadge ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">SeverityBadge</h2>
        <div className="flex gap-3">
          <SeverityBadge severity="critical" />
          <SeverityBadge severity="high" />
          <SeverityBadge severity="medium" />
          <SeverityBadge severity="low" />
        </div>
      </section>

      <Separator />

      {/* ── CurrencyAmount ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">CurrencyAmount</h2>
        <div className="flex flex-col gap-2">
          <CurrencyAmount value="145200.00" />
          <CurrencyAmount value="-1234.56" />
          <CurrencyAmount value={0} />
          <CurrencyAmount value="not-a-number" />
        </div>
      </section>

      <Separator />

      {/* ── MetricChange ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">MetricChange</h2>
        <div className="flex gap-6">
          <MetricChange value={12.3} />
          <MetricChange value={-4.2} />
          <MetricChange value={0} />
        </div>
      </section>

      <Separator />

      {/* ── AlertBadge ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">AlertBadge</h2>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span>count=0 →</span>
            <span className="relative inline-block">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm">
                0
              </span>
              <AlertBadge count={0} />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>count=3 →</span>
            <span className="relative inline-block">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm">
                3
              </span>
              <AlertBadge count={3} />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>count=15 →</span>
            <span className="relative inline-block">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm">
                15
              </span>
              <AlertBadge count={15} />
            </span>
          </div>
        </div>
      </section>

      <Separator />

      {/* ── FinancialTable ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">FinancialTable</h2>
        <FinancialTable columns={TABLE_COLUMNS} data={TABLE_DATA} />
      </section>

      <Separator />

      {/* ── DataTimestamp ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">DataTimestamp (amber = stale {">"}12h)</h2>
        <div className="flex flex-col gap-2">
          <DataTimestamp date={staleDate} label="Last synced" />
          <DataTimestamp date={freshDate} label="Last synced" />
        </div>
      </section>

      <Separator />

      {/* ── Skeleton components ── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Skeleton components</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="mb-2 text-sm text-gray-500">MetricCardSkeleton</p>
            <MetricCardSkeleton />
          </div>
          <div>
            <p className="mb-2 text-sm text-gray-500">FindingCardSkeleton</p>
            <FindingCardSkeleton />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-gray-500">AIResponseSkeleton</p>
          <AIResponseSkeleton />
        </div>
      </section>
    </div>
  );
}
