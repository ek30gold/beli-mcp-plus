import type { ListFieldProbe, ProbeReport } from "./probe.js";

/**
 * Render `packages/contract/src/discovered.ts` from a live probe report.
 *
 * Generated rather than hand-written on purpose. The discovery task's evidence
 * standard is id-overlap against get-ranking / get-bookmark, and every value
 * has to carry CONFIRMED or ASSUMED honestly. Transcribing that by hand is
 * exactly where a "probably BEEN" slips in and becomes a fact nobody rechecks.
 *
 * The rule enforced here: CONFIRMED requires direct evidence in the report.
 * Anything the probe could not establish is emitted as `null` with UNRESOLVED,
 * never as a plausible-looking guess. A wrong value here silently returns the
 * wrong list to the user, so absent evidence must stay visibly absent.
 */

/** Confidence marker attached to every emitted value. */
export type Confidence = "CONFIRMED" | "ASSUMED" | "UNRESOLVED";

const q = (s: string) => JSON.stringify(s);

/** Evidence sentence for a resolved list_field, quoting the actual overlap. */
function listFieldEvidence(lf: ListFieldProbe, candidate: string | null, which: "Been" | "Want-to-Try"): string {
  if (!candidate) {
    const reason = lf.skipped
      ? (lf.skipReason ?? "probe skipped")
      : `no candidate showed decisive id-overlap with ${which}`;
    return `UNRESOLVED — ${reason}`;
  }
  const row = lf.candidates.find((c) => c.candidate === candidate);
  return row ? `CONFIRMED — ${row.conclusion}` : `CONFIRMED — resolved as ${candidate}`;
}

export function renderDiscovered(report: ProbeReport): string {
  const lf = report.listField;
  const authed = report.session.authenticated;
  const account = report.session.userId ?? "(not authenticated)";

  const beenField = lf.bestBeenCandidate;
  const wttField = lf.bestWantToTryCandidate;

  // The recs field is only ever resolved by elimination, never directly, so it
  // is reported as unresolved unless a candidate was explicitly concluded RECS.
  const recsRow = lf.candidates.find((c) => /-> *RECS/i.test(c.conclusion));
  const recsField = recsRow?.candidate ?? null;

  const categories = report.categories.skipped ? [] : report.categories.accepted;
  const rejected = report.categories.skipped
    ? []
    : report.categories.results.filter((r) => !r.ok).map((r) => r.category);

  // A 200 with zero rows is NOT evidence that the value is a real category: it
  // is indistinguishable from a value the endpoint silently ignores. Only
  // categories that actually returned rows are corroborated, so the two groups
  // are emitted separately rather than flattened into one CONFIRMED list.
  const categoriesWithRows = report.categories.skipped
    ? []
    : report.categories.results
        .filter((r) => r.ok && (r.resultCount ?? 0) > 0)
        .map((r) => `${r.category} (${r.resultCount})`);
  const categoriesNoRows = report.categories.skipped
    ? []
    : report.categories.results
        .filter((r) => r.ok && (r.resultCount ?? 0) === 0)
        .map((r) => r.category);

  // Only cite sources that actually succeeded — a failed endpoint contributes
  // no keys and must not appear as provenance for the ones we did observe.
  const facetSources = report.facets.skipped
    ? []
    : [
        ...(report.facets.filterConfigs.ok ? ["/api/filter-configs/"] : []),
        ...(report.facets.filterOptions.ok ? ["/api/filter-options/"] : []),
      ];
  const facetFailures = report.facets.skipped
    ? []
    : [
        ...(report.facets.filterConfigs.ok
          ? []
          : [`/api/filter-configs/ (${report.facets.filterConfigs.status ?? "failed"})`]),
        ...(report.facets.filterOptions.ok
          ? []
          : [`/api/filter-options/ (${report.facets.filterOptions.status ?? "failed"})`]),
      ];

  const facetKeys = report.facets.skipped
    ? []
    : [...new Set([...report.facets.filterConfigs.facetKeys, ...report.facets.filterOptions.facetKeys])];

  const recsShape = report.recs.skipped ? "unknown" : report.recs.recs.shape;
  const recScoreShape = report.recs.skipped ? "unknown" : report.recs.recScore.shape;

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * GENERATED FILE — do not edit by hand.");
  lines.push(" *");
  lines.push(" * Produced by `beli-mcp-plus probe --emit-discovered` from a live run against");
  lines.push(" * the Beli API. Re-run the probe to regenerate; hand edits are overwritten.");
  lines.push(" *");
  lines.push(` * Generated:   ${report.generatedAt}`);
  lines.push(` * Account:     ${account}`);
  lines.push(` * App version: ${report.appVersion}`);
  lines.push(` * Authenticated: ${authed ? "yes" : "NO — every value below is unresolved"}`);
  lines.push(" *");
  lines.push(" * CONFIRMED  = direct evidence in the probe report (quoted per value).");
  lines.push(" * ASSUMED    = best guess, unverified.");
  lines.push(" * UNRESOLVED = the probe could not establish this. Do NOT substitute a guess:");
  lines.push(" *              a wrong list_field silently returns the wrong list.");
  lines.push(" */");
  lines.push("");
  lines.push("/** Reference id counts the list_field overlap evidence was measured against. */");
  lines.push("export const DISCOVERY_REFERENCE = {");
  lines.push(`  beenIdCount: ${lf.beenIdCount ?? "null"},`);
  lines.push(`  wantToTryIdCount: ${lf.wantToTryIdCount ?? "null"},`);
  lines.push("} as const;");
  lines.push("");

  lines.push("/**");
  lines.push(" * `list_field` values for POST /api/filter-list/.");
  lines.push(" *");
  lines.push(` * BEEN:        ${listFieldEvidence(lf, beenField, "Been")}`);
  lines.push(` * WANT_TO_TRY: ${listFieldEvidence(lf, wttField, "Want-to-Try")}`);
  lines.push(
    ` * RECS:        ${recsField ? `ASSUMED — concluded by elimination: ${recsRow?.conclusion}` : "UNRESOLVED — no candidate concluded RECS"}`,
  );
  lines.push(" */");
  lines.push("export const LIST_FIELD = {");
  lines.push(`  BEEN: ${beenField ? q(beenField) : "null"},`);
  lines.push(`  WANT_TO_TRY: ${wttField ? q(wttField) : "null"},`);
  lines.push(`  RECS: ${recsField ? q(recsField) : "null"},`);
  lines.push("} as const;");
  lines.push("");
  lines.push("/** True only when filter-list can actually serve BOTH personal lists. */");
  lines.push(
    `export const FILTER_LIST_SERVES_PERSONAL_LISTS = ${Boolean(beenField && wttField)};`,
  );
  lines.push("");

  lines.push("/**");
  lines.push(" * Category values GET /api/get-ranking/ accepted live (no error).");
  if (categories.length > 0) {
    lines.push(
      ` * CONFIRMED (returned rows): ${categoriesWithRows.join(", ") || "none"}`,
    );
    lines.push(
      ` * UNCORROBORATED (HTTP 200 but 0 rows — cannot be distinguished from a`,
    );
    lines.push(
      ` *   value the endpoint silently ignores): ${categoriesNoRows.join(", ") || "none"}`,
    );
    lines.push(` * rejected: ${rejected.join(", ") || "none"}`);
  } else {
    lines.push(" * UNRESOLVED — category probe did not run");
  }
  lines.push(" */");
  lines.push(
    `export const CATEGORIES = ${categories.length > 0 ? `[${categories.map(q).join(", ")}] as const` : "[] as const"};`,
  );
  lines.push("");
  lines.push("/** Subset of CATEGORIES actually corroborated by returned rows. */");
  lines.push(
    `export const CATEGORIES_WITH_ROWS = ${
      categoriesWithRows.length > 0
        ? `[${report.categories.results
            .filter((r) => r.ok && (r.resultCount ?? 0) > 0)
            .map((r) => q(r.category))
            .join(", ")}] as const`
        : "[] as const"
    };`,
  );
  lines.push("");

  lines.push("/**");
  lines.push(
    ` * Facet keys observed in: ${facetSources.join(", ") || "(no source succeeded)"}.`,
  );
  if (facetFailures.length > 0) {
    lines.push(
      ` * Contributed nothing (failed): ${facetFailures.join(", ")}.`,
    );
  }
  lines.push(
    ` * ${facetKeys.length > 0 ? `CONFIRMED — observed live in ${facetSources.join(", ")}` : "UNRESOLVED — facet probe did not run or returned no keys"}`,
  );
  lines.push(" */");
  lines.push(
    `export const FACET_KEYS = ${facetKeys.length > 0 ? `[${facetKeys.map(q).join(", ")}] as const` : "[] as const"};`,
  );
  lines.push("");

  // An "empty" or "unknown" shape is NOT evidence of a shape. A recs endpoint
  // that returned nothing tells us the call worked, not whether it returns a
  // curated list or a score map — the actual question. Claiming CONFIRMED here
  // would put an unearned fact in front of whoever builds the recs tool.
  const shapeIsEvidence = (shape: string) => shape === "curated-list" || shape === "score-map";
  const recsConfidence = report.recs.skipped
    ? "UNRESOLVED — recs probe did not run"
    : shapeIsEvidence(recsShape) || shapeIsEvidence(recScoreShape)
      ? "CONFIRMED — observed live"
      : `UNRESOLVED — endpoints answered but returned ${recsShape}/${recScoreShape}, ` +
        "which does not distinguish a curated list from a score map";

  lines.push("/**");
  lines.push(" * Shape of the recs endpoints.");
  lines.push(` * GET {RECS}/api/recs/{uuid}/ -> ${recsShape}`);
  lines.push(` * GET /api/rec-score/         -> ${recScoreShape}`);
  lines.push(` * ${recsConfidence}`);
  lines.push(" */");
  lines.push("export const RECS_SHAPE = {");
  lines.push(`  recs: ${q(recsShape)},`);
  lines.push(`  recScore: ${q(recScoreShape)},`);
  lines.push("} as const;");
  lines.push("");

  // Item-level field evidence. Only keys seen on EVERY item are safe to type
  // as required; anything partial stays optional, and no evidence at all means
  // the item shape stays UNRESOLVED rather than being inferred.
  const itemKeys = report.recs.skipped ? null : report.recs.recs.itemKeys;
  lines.push("/**");
  lines.push(" * Field evidence for ONE item from GET {RECS}/api/recs/{uuid}/.");
  if (itemKeys) {
    lines.push(
      ` * CONFIRMED — every one of ${itemKeys.itemsExamined} items examined live carried`,
    );
    lines.push(
      ` *   these keys: ${itemKeys.universalKeys.join(", ") || "(none)"}`,
    );
    if (itemKeys.partialKeys.length > 0) {
      lines.push(
        ` * PARTIAL (present on some items only — must stay optional): ${itemKeys.partialKeys.join(", ")}`,
      );
    }
    lines.push(" * Observed value types are recorded below. Key names and types only —");
    lines.push(" * no item values are captured, since this file is committed.");
  } else {
    lines.push(" * UNRESOLVED — no object item was available to examine. Do NOT type");
    lines.push(" * item fields from a third-party doc or from a plausible-sounding name.");
  }
  lines.push(" */");
  if (itemKeys) {
    lines.push("export const RECS_ITEM_SHAPE = {");
    lines.push(`  itemsExamined: ${itemKeys.itemsExamined},`);
    lines.push(
      `  universalKeys: [${itemKeys.universalKeys.map(q).join(", ")}] as const,`,
    );
    lines.push(
      `  partialKeys: [${itemKeys.partialKeys.map(q).join(", ")}] as const,`,
    );
    lines.push("  keyTypes: {");
    for (const key of [...itemKeys.universalKeys, ...itemKeys.partialKeys]) {
      lines.push(`    ${q(key)}: [${(itemKeys.keyTypes[key] ?? []).map(q).join(", ")}] as const,`);
    }
    lines.push("  },");
    lines.push("} as const;");
  } else {
    lines.push("export const RECS_ITEM_SHAPE = null;");
  }
  lines.push("");

  return lines.join("\n");
}
