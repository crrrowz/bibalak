import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useStyle } from "@/stores/style";
import { OnboardingModal } from "./OnboardingModal";

function OnboardingGateInner() {
  const style = useStyle((s) => s.style);
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.motivationState,
    queryFn: () => ipc.getMotivationState(style),
  });

  if (isPending || isError || !data || data.onboarding_completed) {
    return null;
  }

  return <OnboardingModal />;
}

/**
 * Mount point in AppShell for the first-run onboarding wizard (16f).
 * Renders the wizard only when motivation state reports `onboarding_completed === false`.
 */
export function OnboardingGate() {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) return null;
  return <OnboardingGateInner />;
}
