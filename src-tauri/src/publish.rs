use crate::commands::PublishConfig;

#[derive(Debug, PartialEq, Eq)]
pub struct DotnetPublishPlan {
    pub program: String,
    pub args: Vec<String>,
}

/// Build the CLI argument list for `dotnet publish`.
///
/// **Deprecated**: This function is retained for backward-compatibility with
/// the legacy `execute_publish` command.  New code should go through the
/// Provider system (`execute_provider_publish`).
#[deprecated(note = "Use the provider system (execute_provider_publish) instead")]
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

        if !config.framework.is_empty() {
            args.push("--framework".to_string());
            args.push(config.framework.clone());
        }

        if config.self_contained {
            args.push("--self-contained".to_string());
        }
    }

    if !config.output_dir.is_empty() {
        args.push("-o".to_string());
        args.push(config.output_dir.clone());
    }

    if config.no_build {
        args.push("--no-build".to_string());
    }

    if config.no_restore {
        args.push("--no-restore".to_string());
    }

    if !config.verbosity.is_empty() {
        args.push("--verbosity".to_string());
        args.push(config.verbosity.clone());
    }

    if config.no_logo {
        args.push("--no-logo".to_string());
    }

    for define in &config.define {
        args.push("--define".to_string());
        args.push(define.clone());
    }

    for (key, value) in &config.properties {
        if config.use_profile && key == "PublishProfile" {
            continue;
        }
        args.push(format!("-p:{}={}", key, value));
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
        PublishConfig::default()
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
