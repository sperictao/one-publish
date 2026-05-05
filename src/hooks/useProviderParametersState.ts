import {
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { ParameterValue } from "@/types/parameters";

export type ProviderParametersById = Record<
  string,
  Record<string, ParameterValue>
>;

const EMPTY_PROVIDER_PARAMETERS: Record<string, ParameterValue> = {};

export interface UseProviderParametersStateParams {
  activeProviderId: string;
}

export function useProviderParametersState({
  activeProviderId,
}: UseProviderParametersStateParams): {
  activeProviderParameters: Record<string, ParameterValue>;
  setProviderParameters: Dispatch<SetStateAction<ProviderParametersById>>;
} {
  const [providerParameters, setProviderParameters] =
    useState<ProviderParametersById>({});

  const activeProviderParameters = useMemo(
    () => providerParameters[activeProviderId] ?? EMPTY_PROVIDER_PARAMETERS,
    [activeProviderId, providerParameters]
  );

  return {
    activeProviderParameters,
    setProviderParameters,
  };
}
