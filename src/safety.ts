import { resolveSafetyLevel, type SafetyLevel } from "./config.ts";

export class SafetyBlockedError extends Error {}

/** Minimal structural view of the extension context the guard needs. */
export interface MutationContext {
  hasUI?: boolean;
  ui?: {
    confirm(title: string, message: string): Promise<boolean>;
  };
}

/**
 * Gate a mutating tool call according to the resolved safetyLevel:
 * - "readonly": always blocked.
 * - "confirm" (default): prompts the user via ctx.ui.confirm when a UI is available,
 *   otherwise blocked with guidance to set safetyLevel "open" for headless runs.
 * - "open": proceeds without prompting.
 */
export async function guardMutation(
  config: { safetyLevel: SafetyLevel },
  site: { name: string; safetyLevel?: SafetyLevel },
  ctx: MutationContext | undefined,
  { title, message }: { title: string; message: string },
): Promise<void> {
  const level = resolveSafetyLevel(config, site);

  if (level === "readonly") {
    throw new SafetyBlockedError(`Blocked: safetyLevel is "readonly" for site "${site.name}". ${title} was not performed.`);
  }

  if (level === "open") {
    return;
  }

  // level === "confirm"
  if (!ctx?.hasUI) {
    throw new SafetyBlockedError(
      `Blocked: safetyLevel is "confirm" but no UI is available to prompt for approval in this run mode. ` +
        `Set safetyLevel to "open" for site "${site.name}" to allow unattended writes.`,
    );
  }

  const approved = await ctx!.ui!.confirm(title, message);
  if (!approved) {
    throw new SafetyBlockedError(`Blocked by user: ${title}.`);
  }
}
