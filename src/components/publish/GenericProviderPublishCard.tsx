import { Import, Loader2, Play, Settings, Square } from "lucide-react";

import { ParameterEditor } from "@/components/publish/ParameterEditor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ParameterSchema, ParameterValue } from "@/types/parameters";

interface GenericProviderPublishCardProps {
  activeProviderLabel: string;
  activeProviderSchema: ParameterSchema | null;
  activeProviderParameters: Record<string, ParameterValue>;
  appT: Record<string, string | undefined>;
  configT: Record<string, string | undefined>;
  isPublishing: boolean;
  isCancellingPublish: boolean;
  onOpenCommandImport: () => void;
  onProviderParametersChange: (next: Record<string, ParameterValue>) => void;
  onOpenEnvironmentCheck: () => void;
  onExecutePublish: () => void;
  onCancelPublish: () => void;
}

export function GenericProviderPublishCard({
  activeProviderLabel,
  activeProviderSchema,
  activeProviderParameters,
  appT,
  configT,
  isPublishing,
  isCancellingPublish,
  onOpenCommandImport,
  onProviderParametersChange,
  onOpenEnvironmentCheck,
  onExecutePublish,
  onCancelPublish,
}: GenericProviderPublishCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {configT.title || "发布配置"}
            </CardTitle>
            <CardDescription>
              {(appT.providerConfigReady || "{{provider}} Provider 已就绪（支持参数映射与通用执行）").replace(
                "{{provider}}",
                activeProviderLabel,
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenCommandImport}>
            <Import className="h-4 w-4 mr-1" />
            {appT.importFromCommand || "从命令导入"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-sm text-amber-700">
          {(appT.providerConfigHint || "当前已支持 {{provider}} 的命令导入映射、参数编辑与通用执行。").replace(
            "{{provider}}",
            activeProviderLabel,
          )}
        </div>
        {activeProviderSchema ? (
          <ParameterEditor
            schema={activeProviderSchema}
            parameters={activeProviderParameters}
            onChange={onProviderParametersChange}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {appT.loadingProviderSchema || "正在加载 Provider 参数定义..."}
          </div>
        )}
        <div className="rounded-xl bg-[var(--glass-input-bg)] p-3">
          <div className="mb-2 text-xs text-muted-foreground">
            {appT.parameterSnapshot || "当前参数快照（可保存为配置文件）:"}
          </div>
          <pre className="max-h-40 overflow-auto text-xs font-mono">
            {JSON.stringify(activeProviderParameters, null, 2)}
          </pre>
        </div>
        <Button type="button" variant="outline" onClick={onOpenEnvironmentCheck}>
          {appT.openEnvironmentCheck || "打开环境检查"}
        </Button>
        <Button className="w-full" size="lg" onClick={onExecutePublish} disabled={isPublishing}>
          {isPublishing ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              {configT.publishing || "发布中..."}
            </>
          ) : (
            <>
              <Play className="h-5 w-5 mr-2" />
              {configT.execute || "执行发布"}
            </>
          )}
        </Button>
        {isPublishing && (
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={onCancelPublish}
            disabled={isCancellingPublish}
          >
            {isCancellingPublish ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {appT.cancelling || "取消中..."}
              </>
            ) : (
              <>
                <Square className="h-4 w-4 mr-2" />
                {appT.cancelPublish || "取消发布"}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
