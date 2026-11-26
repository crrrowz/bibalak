import type { CalendarOccurrenceDto, TaskDto } from "@bibalak/ipc-types";

export type BlockPayload =
  | { kind: "event"; id: string; occ: CalendarOccurrenceDto }
  | { kind: "task"; id: string; task: TaskDto };

export type TimedBlock = BlockPayload & {
  title: string;
  startMs: number;
  endMs: number;
  startMin: number;
  endMin: number;
  isRecurring: boolean;
};

export interface ExternalDropTarget {
  date: string;
  startMin: number | null;
  isAllDay: boolean;
}
