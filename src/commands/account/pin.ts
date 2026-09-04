import { EXIT, ExitError } from "../../exit.ts";

export async function runPin(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account pin is not implemented yet");
}
export async function runUnpin(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account unpin is not implemented yet");
}
export async function runDisable(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account disable is not implemented yet");
}
export async function runEnable(_args: string[]): Promise<number> {
  throw new ExitError(EXIT.USAGE, "account enable is not implemented yet");
}
