import { classifyMode } from "./argv.ts";
import { runAccount } from "./commands/account/index.ts";
import { runVersionCommand } from "./commands/version.ts";
import { ExitError } from "./exit.ts";
import { runHook } from "./hook.ts";
import { runPassthrough } from "./launch.ts";
import { warn } from "./log.ts";

async function main(argv: string[]): Promise<number> {
  const mode = classifyMode(argv);
  switch (mode.kind) {
    case "hook":
      await runHook();
      return 0;
    case "version":
      return runVersionCommand();
    case "account":
      return runAccount(mode.args);
    case "passthrough":
      return runPassthrough(mode.argv, { forced: mode.forced });
  }
}

try {
  const code = await main(process.argv.slice(2));
  process.exit(code);
} catch (e) {
  if (e instanceof ExitError) {
    if (e.message) warn(e.message);
    process.exit(e.code);
  }
  warn(`unexpected error: ${(e as Error)?.stack ?? String(e)}`);
  process.exit(1);
}
