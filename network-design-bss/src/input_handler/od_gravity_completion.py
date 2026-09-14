import numpy as np
import pandas as pd


def complete_od_with_gravity(
    od_df: pd.DataFrame,
    all_zone_ids,
    target_num_pairs: int,
) -> pd.DataFrame:
    """
    Structurally densify an OD matrix: keep every observed inter-zone flow
    unchanged, and add just enough synthetic inter-zone pairs (chosen by a
    one-shot gravity-model magnitude) so the total number of inter-zone OD
    pairs reaches `target_num_pairs`.

    Rule
    ----
    - Origin/destination marginals O_i, D_j are the observed per-zone flow
      totals (summed over the real inter-zone rows in od_df).
    - Zones in `all_zone_ids` with no observation get the median of the
      observed nonzero marginals ("typical zone" assumption) so they can
      still participate in the gravity formula.
    - Every unobserved ordered pair (i, j), i != j, gets a candidate flow
      flow_ij = O_i * D_j / T  (T = sum of O over all zones).
    - Candidates are ranked by that magnitude; the strongest ones are added
      until the observed + synthetic row count hits target_num_pairs.

    This is a one-shot gravity seed, not a re-run of IPF (marginals are not
    re-balanced after completion) — it is only used to decide *which*
    additional structural pairs to activate, grounded in the same marginal
    totals IPF already fitted. Self-loop (intra-zone) rows in od_df are
    passed through unchanged and are not counted toward target_num_pairs.

    Returns a DataFrame with columns [origin_cell, dest_cell, flow, source],
    source in {"observed", "gravity_synthetic"}.
    """
    all_zone_ids = list(all_zone_ids)
    n_zones = len(all_zone_ids)

    interzone = od_df[od_df.origin_cell != od_df.dest_cell].copy()
    selfloop = od_df[od_df.origin_cell == od_df.dest_cell].copy()

    observed_pairs = set(zip(interzone.origin_cell, interzone.dest_cell))
    n_observed = len(observed_pairs)

    max_possible = n_zones * (n_zones - 1)
    if target_num_pairs < n_observed:
        raise ValueError(
            f"target_num_pairs ({target_num_pairs}) is below the number of "
            f"observed inter-zone pairs ({n_observed}); densification only "
            f"adds pairs, it never removes observed ones."
        )
    if target_num_pairs > max_possible:
        raise ValueError(
            f"target_num_pairs ({target_num_pairs}) exceeds full connectivity "
            f"({max_possible}) for {n_zones} zones."
        )

    origin_totals = interzone.groupby("origin_cell")["flow"].sum()
    dest_totals = interzone.groupby("dest_cell")["flow"].sum()
    o_fill = float(origin_totals.median()) if len(origin_totals) else 1.0
    d_fill = float(dest_totals.median()) if len(dest_totals) else 1.0

    O = pd.Series({z: float(origin_totals.get(z, o_fill)) for z in all_zone_ids})
    D = pd.Series({z: float(dest_totals.get(z, d_fill)) for z in all_zone_ids})
    T = O.sum()

    n_needed = target_num_pairs - n_observed
    if n_needed == 0:
        interzone["source"] = "observed"
        selfloop["source"] = "observed"
        return pd.concat([interzone, selfloop], ignore_index=True)

    candidates = [
        (i, j, O[i] * D[j] / T)
        for i in all_zone_ids
        for j in all_zone_ids
        if i != j and (i, j) not in observed_pairs
    ]
    cand_df = pd.DataFrame(candidates, columns=["origin_cell", "dest_cell", "flow"])
    cand_df = cand_df.sort_values("flow", ascending=False).head(n_needed).copy()
    cand_df["flow"] = np.maximum(1, np.round(cand_df["flow"])).astype(int)
    cand_df["source"] = "gravity_synthetic"

    interzone["source"] = "observed"
    selfloop["source"] = "observed"

    return pd.concat([interzone, cand_df, selfloop], ignore_index=True)
