import { useQuery } from "@tanstack/react-query";
import { checkForUpdate, getSystemVersion } from "../api/system";

/** Shared between the header banner and the Settings card (one request). */
export function useUpdateCheck() {
  const version = useQuery({ queryKey: ["system-version"], queryFn: getSystemVersion, staleTime: 5 * 60_000 });
  const check = useQuery({
    queryKey: ["update-check"],
    queryFn: () => checkForUpdate(false),
    enabled: version.data?.updaterConfigured === true,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: false,
  });
  return { version, check };
}
