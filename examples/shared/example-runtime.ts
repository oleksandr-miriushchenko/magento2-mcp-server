/** Error whose message is safe to show because it contains only fixed or allowlisted text. */
export class SafeExampleError extends Error {
  override readonly name = "SafeExampleError";
}

/** Runs an example without exposing arbitrary SDK error details to the terminal. */
export async function runExample(name: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const details =
      error instanceof SafeExampleError
        ? ` ${error.message}`
        : " SDK or service error details were suppressed because they may contain sensitive data.";
    process.stderr.write(`[${name}] Failed.${details}\n`);
    process.exitCode = 1;
  }
}
