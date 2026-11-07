import { describe, expect, it } from "vitest";
import { isCurrentFridayWorkflow } from "./workflowRequestGuard";

describe("Friday workflow request guard", () => {
  it("accepts only the current non-aborted controller", () => {
    const controller = new AbortController();
    expect(isCurrentFridayWorkflow(controller, controller)).toBe(true);
    expect(isCurrentFridayWorkflow(controller, undefined)).toBe(false);
    expect(isCurrentFridayWorkflow(controller, new AbortController())).toBe(false);
  });

  it("rejects a controller after cancellation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isCurrentFridayWorkflow(controller, controller)).toBe(false);
  });
});
