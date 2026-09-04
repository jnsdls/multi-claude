/** Exit codes from the spec. Passthrough otherwise mirrors the child. */
export const EXIT = {
  OK: 0,
  /** Refused: failed login, live session, Needs login under Pin or Override. */
  REFUSED: 1,
  /** Usage error (sysexits EX_USAGE). */
  USAGE: 64,
  /** Duplicate Account or identity mismatch (EX_DATAERR). */
  DUPLICATE: 65,
  /** claude not found or below the Version floor (EX_UNAVAILABLE). */
  NO_CLAUDE: 69,
  /** Exhausted with onExhausted=fail (EX_TEMPFAIL). */
  EXHAUSTED: 75,
  /** Bad config.json (EX_CONFIG). */
  CONFIG: 78,
} as const;

/** Thrown to unwind to main() with a message for stderr and an exit code. */
export class ExitError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
