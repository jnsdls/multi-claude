// The four compiled targets and the npm platform package each one ships in.
export const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
export type Target = (typeof TARGETS)[number];

export function platformPackage(target: Target): string {
  return `multi-claude-${target}`;
}
