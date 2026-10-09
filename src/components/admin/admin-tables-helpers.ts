/**
 * Admin Tables — pure helpers.
 *
 * Framework-independent mapping for the physical-table list result, the
 * room-options list result, and a stale-response guard. Tested directly;
 * consumed by the component.
 */
import type {
  DiningTableDTO,
  DiningTableListResult,
  DiningTableRoomOptionsResult,
  DiningTableRoomOption,
} from "@/lib/sundays/types";

export type TableLoadState = "loading" | "loaded" | "error";

export interface TableListState {
  state: TableLoadState;
  tables: DiningTableDTO[];
  error: string;
}

/**
 * Map the discriminated union list result into a display state.
 * Only a successful repository read may produce { state: "loaded", tables: [] }.
 * Authorization failure, invalid input, and repository failure are all
 * distinguished from a successful empty inventory.
 */
export function tableListFromResult(result: DiningTableListResult): TableListState {
  if (result.ok) {
    return { state: "loaded", tables: result.tables, error: "" };
  }
  return { state: "error", tables: [], error: result.error };
}

export type RoomLoadState = "loading" | "loaded" | "error";

export interface RoomListState {
  state: RoomLoadState;
  rooms: DiningTableRoomOption[];
  error: string;
}

/**
 * Map the discriminated union room-options result into a display state.
 * Only a successful repository read may produce { state: "loaded", rooms: [] }.
 * Authorization failure and repository failure are distinguished from a
 * successful empty list so a failure is never silently converted to an empty
 * room list.
 */
export function roomOptionsFromResult(result: DiningTableRoomOptionsResult): RoomListState {
  if (result.ok) {
    return { state: "loaded", rooms: result.rooms, error: "" };
  }
  return { state: "error", rooms: [], error: result.error };
}

/**
 * Monotonic request guard. Each load issues a new id; a response whose id
 * no longer matches the current id is stale and must be ignored. Prevents an
 * older response from replacing newer data after a room-filter change or
 * unmount.
 */
export function createStaleGuard(): {
  next: () => number;
  isStale: (id: number) => boolean;
} {
  let current = 0;
  return {
    next: () => ++current,
    isStale: (id: number) => id !== current,
  };
}
