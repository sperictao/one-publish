pub mod types;
pub mod cargo_provider;
pub mod dotnet_provider;
pub mod go_provider;
pub mod java_provider;

pub use types::*;
pub use cargo_provider::check_cargo;
pub use dotnet_provider::check_dotnet;
pub use go_provider::check_go;
pub use java_provider::check_java;

/// Run full environment check
pub async fn check_environment() -> Result<EnvironmentCheckResult, Box<dyn std::error::Error>> {
    let mut result = EnvironmentCheckResult::new();

    // Check Rust/Cargo
    let cargo_status = check_cargo().await?;
    result = result.with_provider(cargo_status);

    // Check .NET
    let dotnet_status = check_dotnet().await?;
    result = result.with_provider(dotnet_status);

    // Check Go
    let go_status = check_go().await?;
    result = result.with_provider(go_status);

    // Check Java
    let java_status = check_java().await?;
    result = result.with_provider(java_status);

    result.check_ready();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_environment() {
        let result = check_environment().await.unwrap();
        // The result will depend on what's installed on the test machine
        assert!(!result.providers.is_empty());
    }
}
