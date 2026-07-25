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
