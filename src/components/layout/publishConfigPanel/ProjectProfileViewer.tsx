import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  ProjectPublishProfileViewerDialog,
  type ProjectProfileViewerState,
} from "@/components/publish/ProjectPublishProfileViewerDialog";
import { resolveDotnetProjectProfile } from "@/lib/dotnetProjectProfile";
import { extractInvokeErrorMessage } from "@/lib/tauri/invokeErrors";
import type { ParameterSchema } from "@/types/parameters";

type ViewerTranslations = Record<string, string | undefined>;

export interface ProjectProfileViewerHandle {
  viewProfile: (profileName: string) => void;
}

export interface ProjectProfileViewerProps {
  projectFilePath?: string;
  projectFrameworkOptions?: string[];
  dotnetSchema?: ParameterSchema;
  configPanelT: ViewerTranslations;
  profileT: ViewerTranslations;
  appT: ViewerTranslations;
  commonT: ViewerTranslations;
}

const EMPTY_PROJECT_FRAMEWORK_OPTIONS: string[] = [];

/**
 * Read-only viewer for a project (.pubxml) publish profile.
 *
 * Owns the viewer dialog open/loading/ready/error state machine and the
 * `resolveDotnetProjectProfile` request race-guard. Callers trigger a view
 * imperatively via the exposed ref handle (`viewProfile`).
 */
export const ProjectProfileViewer = forwardRef<
  ProjectProfileViewerHandle,
  ProjectProfileViewerProps
>(function ProjectProfileViewer(
  {
    projectFilePath,
    projectFrameworkOptions = EMPTY_PROJECT_FRAMEWORK_OPTIONS,
    dotnetSchema,
    configPanelT,
    profileT,
    appT,
    commonT,
  },
  ref
) {
  const [open, setOpen] = useState(false);
  const [viewerState, setViewerState] = useState<ProjectProfileViewerState>({
    status: "idle",
    profileName: null,
  });
  const latestRequestId = useRef(0);

  const handleViewProjectProfile = useCallback(
    async (profileName: string) => {
      setOpen(true);

      if (!projectFilePath) {
        const errorMessage = "当前项目文件路径不可用，无法读取发布配置。";
        setViewerState({
          status: "error",
          profileName,
          errorMessage,
        });
        toast.error(configPanelT.loadConfigFailed || "加载配置失败", {
          description: errorMessage,
        });
        return;
      }

      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      setViewerState({
        status: "loading",
        profileName,
      });

      resolveDotnetProjectProfile({
        projectInfo: {
          root_path: "",
          project_file: projectFilePath,
          target_frameworks: projectFrameworkOptions,
        },
        profileName,
      })
        .then((resolvedProfile) => {
          if (latestRequestId.current !== requestId) {
            return;
          }

          setViewerState({
            status: "ready",
            profileName: resolvedProfile.profileName,
            filePath: resolvedProfile.filePath,
            editableConfig: resolvedProfile.editableConfig,
            parsedProfile: resolvedProfile.parsedProfile,
          });
        })
        .catch((error) => {
          if (latestRequestId.current !== requestId) {
            return;
          }

          const errorMessage =
            error instanceof Error
              ? error.message
              : extractInvokeErrorMessage(error);

          setViewerState({
            status: "error",
            profileName,
            errorMessage,
          });
          toast.error(configPanelT.loadConfigFailed || "加载配置失败", {
            description: errorMessage,
          });
        });
    },
    [projectFilePath, projectFrameworkOptions, configPanelT.loadConfigFailed]
  );

  useImperativeHandle(
    ref,
    () => ({
      viewProfile: handleViewProjectProfile,
    }),
    [handleViewProjectProfile]
  );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  return (
    <ProjectPublishProfileViewerDialog
      open={open}
      onOpenChange={handleOpenChange}
      viewerState={viewerState}
      dotnetSchema={dotnetSchema}
      projectFrameworkOptions={projectFrameworkOptions}
      profileT={profileT}
      appT={appT}
      commonT={commonT}
      configPanelT={configPanelT}
    />
  );
});
