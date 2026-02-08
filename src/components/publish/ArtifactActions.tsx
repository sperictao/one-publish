import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  packageArtifact,
  signArtifact,
  type PackageResult,
  type SignResult,
} from "@/lib/artifact";
import { useI18n } from "@/hooks/useI18n";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export interface ArtifactActionState {
  packageResult: PackageResult | null;
  signResult: SignResult | null;
}

export interface ArtifactActionsProps {
  outputDir: string;
  onStateChange?: (state: ArtifactActionState) => void;
}

export function ArtifactActions({ outputDir, onStateChange }: ArtifactActionsProps) {
  const [packaging, setPackaging] = useState(false);
  const { translations } = useI18n();
  const artifactT = translations.artifact || {};
  const [signing, setSigning] = useState(false);
  const [packageResult, setPackageResult] = useState<PackageResult | null>(null);
  const [signResult, setSignResult] = useState<SignResult | null>(null);

  useEffect(() => {
    setPackageResult(null);
    setSignResult(null);
    setPackaging(false);
    setSigning(false);
  }, [outputDir]);

  useEffect(() => {
    onStateChange?.({ packageResult, signResult });
  }, [onStateChange, packageResult, signResult]);

  const defaultZipPath = useMemo(() => {
    const trimmed = outputDir.replace(/[\\/]+$/, "");
    return trimmed ? `${trimmed}.zip` : "artifact.zip";
  }, [outputDir]);

  const handlePackage = async () => {
    try {
      const selected = await save({
        title: artifactT.savePackageTitle || "保存打包文件",
        defaultPath: defaultZipPath,
        filters: [{ name: "Zip", extensions: ["zip"] }],
      });
      if (!selected) return;

      setPackaging(true);
      const res = await packageArtifact({
        inputDir: outputDir,
        outputPath: selected,
        includeRootDir: true,
        format: "zip",
      });

      setPackageResult(res);
      toast.success(artifactT.packageDone || "打包完成", { description: res.artifact_path });
    } catch (err) {
      toast.error(artifactT.packageFailed || "打包失败", { description: String(err) });
    } finally {
      setPackaging(false);
    }
  };

  const handleSign = async () => {
    if (!packageResult) return;
    try {
      setSigning(true);
      const res = await signArtifact({
        artifactPath: packageResult.artifact_path,
        method: "gpg_detached",
      });
      setSignResult(res);

      if (res.success) {
        toast.success(artifactT.signDone || "签名完成", { description: res.signature_path });
      } else {
        toast.error(artifactT.signFailed || "签名失败", {
          description: res.stderr || `exitCode: ${res.exit_code}`,
        });
      }
    } catch (err) {
      toast.error(artifactT.signFailed || "签名失败", { description: String(err) });
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePackage}
          disabled={!outputDir || packaging}
        >
          {packaging ? artifactT.packaging || "打包中..." : artifactT.packageZip || "打包 ZIP"}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSign}
          disabled={!packageResult || signing}
        >
          {signing ? artifactT.signing || "签名中..." : artifactT.signGpg || "签名 (GPG)"}
        </Button>
      </div>

      {packageResult && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="font-mono break-all">{packageResult.artifact_path}</div>
          <div>
            {packageResult.file_count} files, {formatBytes(packageResult.bytes)}
          </div>
          <div className="font-mono break-all">sha256: {packageResult.sha256}</div>
        </div>
      )}

      {signResult && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="font-mono break-all">{signResult.signature_path}</div>
          {signResult.stdout && (
            <div className="font-mono break-all whitespace-pre-wrap">
              {signResult.stdout}
            </div>
          )}
          {signResult.stderr && (
            <div className="font-mono break-all whitespace-pre-wrap">
              {signResult.stderr}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
