import { Skeleton } from "@/components/ui/skeleton";

/**
 * 面板懒加载骨架：顶部标题条 + 搜索条 + 若干列表行。
 * 形状对应三栏（仓库列表/发布配置）的通用布局，消除懒加载期间的白块。
 */
export function PanelSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-6 w-6 rounded-md" />
      </div>
      <Skeleton className="h-8 w-full rounded-sm" />
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
