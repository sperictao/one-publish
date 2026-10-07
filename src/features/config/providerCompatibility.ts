/**
 * 配置 Provider 是否属于当前仓库：与后端 `Repository::provider_mismatch_reason`
 * 同一规则——仓库声明了 Provider 时必须一致，未声明时不限制。
 */
export function isProviderCompatibleWithRepository(
  repositoryProviderId: string | null | undefined,
  providerId: string
): boolean {
  const declaredProviderId = repositoryProviderId?.trim();
  return !declaredProviderId || declaredProviderId === providerId;
}
