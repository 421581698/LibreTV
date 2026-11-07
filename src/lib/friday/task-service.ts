import { TaskRuntime } from "./task-runtime";
import { fridayTaskEventStore } from "./dexie-task-event-store";

// Client-side runtime singleton. Import this module only from browser-facing code.
export { fridayTaskEventStore };
export const fridayTaskRuntime = new TaskRuntime(fridayTaskEventStore);
