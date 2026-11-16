// Shared by the server (whether to keep a proposed fix) and the page (whether to offer it).

/** True when at least one claim is out of date or wrong, so a corrected note says something new. */
export function hasRealFix(claims: { status: string }[]) {
  return claims.some((c) => c.status === "outdated" || c.status === "contradicted");
}
