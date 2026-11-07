export function isCurrentFridayWorkflow(
  controller: AbortController,
  activeController: AbortController | undefined,
): boolean {
  return activeController === controller && !controller.signal.aborted;
}
