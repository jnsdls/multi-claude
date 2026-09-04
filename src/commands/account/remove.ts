import { EXIT, ExitError } from "../../exit.ts";

export async function runRemove(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account remove is not implemented yet");
}
