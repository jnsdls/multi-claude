import { EXIT, ExitError } from "../../exit.ts";

export async function runList(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account list is not implemented yet");
}
