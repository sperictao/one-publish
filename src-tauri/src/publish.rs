use crate::commands::PublishConfig;

#[derive(Debug, PartialEq, Eq)]
pub struct DotnetPublishPlan {
    pub program: String,
    pub args: Vec<String>,
}

pub fn build_dotnet_publish_plan(project_path: &str, config: &PublishConfig) -> DotnetPublishPlan {
    let mut args = vec!["publish".to_string(), project_path.to_string()];

    if config.use_profile && !config.profile_name.is_empty() {
        args.push(format!("/p:PublishProfile={}", config.profile_name));
    } else {
        args.push("-c".to_string());
        args.push(config.configuration.clone());

        if !config.runtime.is_empty() {
            args.push("--runtime".to_string());
            args.push(config.runtime.clone());
        }

        if config.self_contained {
            args.push("--self-contained".to_string());
        }

        if !config.output_dir.is_empty() {
            args.push("-o".to_string());
            args.push(config.output_dir.clone());
        }
    }

    DotnetPublishPlan {
        program: "dotnet".to_string(),
        args,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> PublishConfig {
        PublishConfig {
            configuration: "Release".to_string(),
            runtime: "".to_string(),
            self_contained: false,
            output_dir: "".to_string(),
            use_profile: false,
            profile_name: "".to_string(),
        }
    }

    #[test]
    fn plan_with_profile_uses_pubxml_property() {
        let mut cfg = base_config();
        cfg.use_profile = true;
        cfg.profile_name = "FolderProfile".to_string();

        let plan = build_dotnet_publish_plan("/p/app.csproj", &cfg);

        assert_eq!(plan.program, "dotnet");
        assert_eq!(
            plan.args,
            vec![
                "publish".to_string(),
                "/p/app.csproj".to_string(),
                "/p:PublishProfile=FolderProfile".to_string(),
            ]
        );
    }

    #[test]
    fn plan_without_profile_includes_flags() {
        let mut cfg = base_config();
        cfg.runtime = "win-x64".to_string();
        cfg.self_contained = true;
        cfg.output_dir = "./out".to_string();

        let plan = build_dotnet_publish_plan("/p/app.csproj", &cfg);

        assert_eq!(
            plan.args,
            vec![
                "publish".to_string(),
                "/p/app.csproj".to_string(),
                "-c".to_string(),
                "Release".to_string(),
                "--runtime".to_string(),
                "win-x64".to_string(),
                "--self-contained".to_string(),
                "-o".to_string(),
                "./out".to_string(),
            ]
        );
    }
}
