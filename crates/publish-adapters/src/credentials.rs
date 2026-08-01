use std::collections::BTreeMap;

use publish_domain::{CredentialKind, CredentialValue, ResolvedCredential};

/// Execution Backend 解析一个凭据引用的失败方式；类型匹配由注册表统一校验，
/// 因此这里只区分“不存在”与“无权访问”。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialResolveFailure {
    Missing,
    AccessDenied,
}

/// 后端受支持 Secret Store 的最小抽象：按非秘密引用在执行边界解析实际值。
/// 实现方（钥匙串、环境、远端 Secret Store）决定引用的含义。
pub trait CredentialSource: Send + Sync {
    fn resolve(&self, reference: &str) -> Result<ResolvedCredential, CredentialResolveFailure>;
}

/// 预先注入的凭据来源：为本地开发与测试提供确定性的解析结果，
/// 不是新的秘密管理产品（Issue T08）。
#[derive(Default)]
pub struct StaticCredentialSource {
    entries: BTreeMap<String, Result<ResolvedCredential, CredentialResolveFailure>>,
}

impl StaticCredentialSource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_secret(
        mut self,
        reference: impl Into<String>,
        kind: CredentialKind,
        value: impl Into<String>,
    ) -> Self {
        self.entries.insert(
            reference.into(),
            Ok(ResolvedCredential {
                kind,
                value: CredentialValue::new(value),
            }),
        );
        self
    }

    pub fn with_denied(mut self, reference: impl Into<String>) -> Self {
        self.entries.insert(
            reference.into(),
            Err(CredentialResolveFailure::AccessDenied),
        );
        self
    }
}

impl CredentialSource for StaticCredentialSource {
    fn resolve(&self, reference: &str) -> Result<ResolvedCredential, CredentialResolveFailure> {
        self.entries
            .get(reference)
            .cloned()
            .unwrap_or(Err(CredentialResolveFailure::Missing))
    }
}

/// 环境变量凭据源（决议 #87 / ADR-0029）：workflow 把映射表声明的 Secrets
/// 注入 env，执行边界按非秘密引用查映射取值；凭据类型以 Adapter 声明为准，
/// 由注册表装配时 join 进条目。秘密值只在解析瞬间离开 env。
pub struct EnvCredentialSource {
    entries: BTreeMap<String, (String, CredentialKind)>,
}

impl EnvCredentialSource {
    pub fn new(entries: BTreeMap<String, (String, CredentialKind)>) -> Self {
        Self { entries }
    }
}

impl CredentialSource for EnvCredentialSource {
    fn resolve(&self, reference: &str) -> Result<ResolvedCredential, CredentialResolveFailure> {
        let (variable, kind) = self
            .entries
            .get(reference)
            .ok_or(CredentialResolveFailure::Missing)?;
        let value = std::env::var(variable).map_err(|_| CredentialResolveFailure::Missing)?;
        Ok(ResolvedCredential {
            kind: *kind,
            value: CredentialValue::new(value),
        })
    }
}

#[cfg(test)]
mod env_source_tests {
    use super::*;

    #[test]
    fn env_sources_resolve_mapped_references_with_the_declared_kind() {
        let variable = "ONE_PUBLISH_TEST_ENV_CREDENTIAL";
        std::env::set_var(variable, "token-value");
        let source = EnvCredentialSource::new(BTreeMap::from([(
            "ci github-token".to_string(),
            (variable.to_string(), CredentialKind::Token),
        )]));

        let resolved = source
            .resolve("ci github-token")
            .expect("resolve the mapped reference from env");
        assert_eq!(resolved.kind, CredentialKind::Token);
        assert_eq!(resolved.value.expose(), "token-value");

        assert_eq!(
            source.resolve("unmapped-reference").unwrap_err(),
            CredentialResolveFailure::Missing
        );
        std::env::remove_var(variable);
        assert_eq!(
            source.resolve("ci github-token").unwrap_err(),
            CredentialResolveFailure::Missing
        );
    }
}
