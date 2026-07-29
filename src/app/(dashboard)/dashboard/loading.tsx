import { FindingCardSkeleton } from "@/components/dashboard/FindingCardSkeleton";

export default function Loading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <FindingCardSkeleton />
      <FindingCardSkeleton />
      <FindingCardSkeleton />
    </div>
  );
}
