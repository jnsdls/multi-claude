// `mclaude account <subcommand>`: the management commands.
import { EXIT, ExitError } from "../../exit.ts";

export const ACCOUNT_HELP = `usage: mclaude account <command>

  add [alias] [--email <e>] [--sso]   log in to a new Account through Claude Code
  login <account>                     log in again in place
  list [--refresh] [--json]           every Account with its headroom
  rename <account> <alias>            change an Alias
  remove <account> [--yes] [--force]  log out and delete an Account
  pin <account> | unpin               hold every launch on one Account
  disable <account> | enable <account>
`;

type Handler = (args: string[]) => Promise<number>;

const handlers: Record<string, () => Promise<Handler>> = {
  add: async () => (await import("./add.ts")).runAdd,
  login: async () => (await import("./login.ts")).runLogin,
  list: async () => (await import("./list.ts")).runList,
  rename: async () => (await import("./rename.ts")).runRename,
  remove: async () => (await import("./remove.ts")).runRemove,
  pin: async () => (await import("./pin.ts")).runPin,
  unpin: async () => (await import("./pin.ts")).runUnpin,
  disable: async () => (await import("./pin.ts")).runDisable,
  enable: async () => (await import("./pin.ts")).runEnable,
};

export async function runAccount(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    process.stderr.write(ACCOUNT_HELP);
    return EXIT.USAGE;
  }
  const load = handlers[sub];
  if (!load) throw new ExitError(EXIT.USAGE, `unknown account command "${sub}"\n${ACCOUNT_HELP}`);
  const handler = await load();
  return handler(args.slice(1));
}
