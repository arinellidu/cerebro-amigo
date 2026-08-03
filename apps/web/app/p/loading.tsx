import { Skeleton } from "@/components/ui/skeleton"

export default function PortalLoading() {
  return (
    <div className="space-y-5 p-5 pt-9">
      <Skeleton className="h-4 w-24 rounded-full" />
      <Skeleton className="h-9 w-52 rounded-lg" />
      <div className="mt-6 space-y-3.5">
        <Skeleton className="h-28 rounded-[1.25rem]" />
        <Skeleton className="h-28 rounded-[1.25rem]" />
        <Skeleton className="h-28 rounded-[1.25rem]" />
      </div>
    </div>
  )
}
