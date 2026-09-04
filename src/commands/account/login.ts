import { EXIT, ExitError } from "../../exit.ts";

export async function runLogin(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account login is not implemented yet");
}
