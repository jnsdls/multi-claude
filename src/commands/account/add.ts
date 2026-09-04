import { EXIT, ExitError } from "../../exit.ts";

export async function runAdd(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account add is not implemented yet");
}
