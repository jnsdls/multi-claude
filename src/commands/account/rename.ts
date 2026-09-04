import { EXIT, ExitError } from "../../exit.ts";

export async function runRename(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account rename is not implemented yet");
}
