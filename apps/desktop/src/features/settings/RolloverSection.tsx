import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Select } from "@/components/ui/select";
import { t } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";

export function RolloverSection() {
  const prefsQuery = useQuery({
    queryKey: queryKeys.collectionPrefs,
    queryFn: ipc.getCollectionPrefs,
  });
  const [msg, setMsg] = useState("");

  const setRolloverMut = useMutation({
    mutationFn: (rollover_hour: number) => ipc.setCollectionPrefs({ rollover_hour }),
    onSuccess: () => {
      setMsg(t("settings.saved"));
      void prefsQuery.refetch();
    },
    onError: (e) => setMsg(errorMessage(e)),
  });

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="rollover-hour" className="text-sm" title={t("settings.rollover.hint")}>
        {t("settings.rollover.label")}
      </label>
      <Select
        id="rollover-hour"
        selectSize="xs"
        containerClassName="w-auto"
        className="text-sm"
        value={prefsQuery.data?.rollover_hour ?? 4}
        disabled={!prefsQuery.data}
        onChange={(e) => setRolloverMut.mutate(Number(e.target.value))}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {h.toString().padStart(2, "0")}:00
          </option>
        ))}
      </Select>
      {msg && (
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {msg}
        </span>
      )}
    </div>
  );
}
