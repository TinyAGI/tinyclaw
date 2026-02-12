//! Three-way text merge (diff3 algorithm).
//!
//! This is the baseline merge strategy used by git. We implement it from scratch
//! using the `similar` crate for LCS-based diffing, following the classic diff3
//! algorithm that partitions the file into stable and unstable regions.
//!
//! References:
//! - Khanna, Kuber, Pierce (2007), "A Formal Investigation of Diff3"
//! - GNU diff3 implementation

use similar::{ChangeTag, TextDiff};

use crate::types::{Diff3Hunk, MergeResult, MergeScenario};

/// Run a three-way merge on line-level text.
///
/// Returns a sequence of hunks, each being either stable (all agree),
/// left-only change, right-only change, or a conflict.
pub fn diff3_hunks(scenario: &MergeScenario<&str>) -> Vec<Diff3Hunk> {
    let base_lines: Vec<&str> = scenario.base.lines().collect();

    // Compute per-base-line edits for left and right
    let left_edits = compute_edits(scenario.base, scenario.left);
    let right_edits = compute_edits(scenario.base, scenario.right);

    // Walk base lines and merge both edit sequences
    let mut hunks = Vec::new();
    let mut bi = 0;
    let mut lei = 0; // left edit index
    let mut rei = 0; // right edit index

    while bi < base_lines.len() || lei < left_edits.len() || rei < right_edits.len() {
        // Handle insertions before the current base line
        let left_insert = get_insert_at(&left_edits, &mut lei, bi);
        let right_insert = get_insert_at(&right_edits, &mut rei, bi);

        if !left_insert.is_empty() || !right_insert.is_empty() {
            if !left_insert.is_empty() && !right_insert.is_empty() {
                if left_insert == right_insert {
                    // Both inserted the same lines
                    hunks.push(Diff3Hunk::LeftChanged(left_insert));
                } else {
                    // Both inserted different lines — conflict
                    hunks.push(Diff3Hunk::Conflict {
                        base: vec![],
                        left: left_insert,
                        right: right_insert,
                    });
                }
            } else if !left_insert.is_empty() {
                hunks.push(Diff3Hunk::LeftChanged(left_insert));
            } else {
                hunks.push(Diff3Hunk::RightChanged(right_insert));
            }
        }

        if bi >= base_lines.len() {
            break;
        }

        // What did each side do with this base line?
        let left_action = get_action_at(&left_edits, &mut lei, bi);
        let right_action = get_action_at(&right_edits, &mut rei, bi);

        match (&left_action, &right_action) {
            // Both kept the line unchanged
            (Edit::Keep, Edit::Keep) => {
                hunks.push(Diff3Hunk::Stable(vec![base_lines[bi].to_string()]));
            }
            // Only left changed (right kept)
            (Edit::Replace(new_lines), Edit::Keep) => {
                hunks.push(Diff3Hunk::LeftChanged(new_lines.clone()));
            }
            (Edit::Delete, Edit::Keep) => {
                // Left deleted, right kept — left changed to nothing
                hunks.push(Diff3Hunk::LeftChanged(vec![]));
            }
            // Only right changed (left kept)
            (Edit::Keep, Edit::Replace(new_lines)) => {
                hunks.push(Diff3Hunk::RightChanged(new_lines.clone()));
            }
            (Edit::Keep, Edit::Delete) => {
                hunks.push(Diff3Hunk::RightChanged(vec![]));
            }
            // Both deleted — stable removal
            (Edit::Delete, Edit::Delete) => {
                // Both agree to delete
            }
            // Both replaced with same content — convergence
            (Edit::Replace(left_new), Edit::Replace(right_new)) if left_new == right_new => {
                hunks.push(Diff3Hunk::LeftChanged(left_new.clone()));
            }
            // Both changed differently — conflict
            (Edit::Replace(left_new), Edit::Replace(right_new)) => {
                hunks.push(Diff3Hunk::Conflict {
                    base: vec![base_lines[bi].to_string()],
                    left: left_new.clone(),
                    right: right_new.clone(),
                });
            }
            (Edit::Replace(left_new), Edit::Delete) => {
                hunks.push(Diff3Hunk::Conflict {
                    base: vec![base_lines[bi].to_string()],
                    left: left_new.clone(),
                    right: vec![],
                });
            }
            (Edit::Delete, Edit::Replace(right_new)) => {
                hunks.push(Diff3Hunk::Conflict {
                    base: vec![base_lines[bi].to_string()],
                    left: vec![],
                    right: right_new.clone(),
                });
            }
        }

        bi += 1;
    }

    coalesce_hunks(hunks)
}

/// Perform a full three-way merge, returning a single MergeResult.
pub fn diff3_merge(scenario: &MergeScenario<&str>) -> MergeResult {
    let hunks = diff3_hunks(scenario);

    let mut merged = String::new();
    let mut all_conflict_base = Vec::new();
    let mut all_conflict_left = Vec::new();
    let mut all_conflict_right = Vec::new();
    let mut has_conflict = false;

    for hunk in &hunks {
        match hunk {
            Diff3Hunk::Stable(lines)
            | Diff3Hunk::LeftChanged(lines)
            | Diff3Hunk::RightChanged(lines) => {
                for line in lines {
                    merged.push_str(line);
                    merged.push('\n');
                }
            }
            Diff3Hunk::Conflict { base, left, right } => {
                has_conflict = true;
                all_conflict_base.extend(base.iter().cloned());
                all_conflict_left.extend(left.iter().cloned());
                all_conflict_right.extend(right.iter().cloned());
            }
        }
    }

    if has_conflict {
        MergeResult::Conflict {
            base: all_conflict_base.join("\n"),
            left: all_conflict_left.join("\n"),
            right: all_conflict_right.join("\n"),
        }
    } else {
        MergeResult::Resolved(merged)
    }
}

/// Extract all conflict regions from a three-way merge.
pub fn extract_conflicts(scenario: &MergeScenario<&str>) -> Vec<MergeScenario<String>> {
    let hunks = diff3_hunks(scenario);
    hunks
        .into_iter()
        .filter_map(|h| match h {
            Diff3Hunk::Conflict { base, left, right } => Some(MergeScenario::new(
                base.join("\n"),
                left.join("\n"),
                right.join("\n"),
            )),
            _ => None,
        })
        .collect()
}

// ──────────────────────────────────────────────────────────────
// Internal: Edit representation and diff computation
// ──────────────────────────────────────────────────────────────

/// What happened to a base line in one side of the merge.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Edit {
    Keep,
    Delete,
    Replace(Vec<String>),
}

/// Represents an edit operation at a specific base line position.
#[derive(Debug, Clone)]
enum EditOp {
    /// Inserted lines before base line `before_base_idx`.
    Insert {
        before_base_idx: usize,
        lines: Vec<String>,
    },
    /// Base line `base_idx` was kept.
    Kept { base_idx: usize },
    /// Base line `base_idx` was deleted.
    Deleted { base_idx: usize },
    /// Base line `base_idx` was replaced with `lines`.
    Replaced { base_idx: usize, lines: Vec<String> },
}

/// Compute edits from base to target, returning a sequence of EditOps.
fn compute_edits(base: &str, target: &str) -> Vec<EditOp> {
    let diff = TextDiff::from_lines(base, target);
    let mut ops = Vec::new();
    let mut base_idx: usize = 0;
    let mut pending_deletes: Vec<usize> = Vec::new();
    let mut pending_inserts: Vec<String> = Vec::new();

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                flush_pending(
                    &mut ops,
                    &mut pending_deletes,
                    &mut pending_inserts,
                    base_idx,
                );
                ops.push(EditOp::Kept { base_idx });
                base_idx += 1;
            }
            ChangeTag::Delete => {
                // Flush inserts that came before this delete
                if !pending_inserts.is_empty() && pending_deletes.is_empty() {
                    ops.push(EditOp::Insert {
                        before_base_idx: base_idx,
                        lines: std::mem::take(&mut pending_inserts),
                    });
                }
                pending_deletes.push(base_idx);
                base_idx += 1;
            }
            ChangeTag::Insert => {
                pending_inserts.push(change.value().trim_end_matches('\n').to_string());
            }
        }
    }

    let base_line_count = base.lines().count();
    flush_pending(
        &mut ops,
        &mut pending_deletes,
        &mut pending_inserts,
        base_line_count,
    );

    ops
}

/// Flush pending deletes and inserts into the ops list.
fn flush_pending(
    ops: &mut Vec<EditOp>,
    pending_deletes: &mut Vec<usize>,
    pending_inserts: &mut Vec<String>,
    next_base_idx: usize,
) {
    if !pending_deletes.is_empty() && !pending_inserts.is_empty() {
        // Delete+Insert = Replace
        let first_del = pending_deletes[0];
        let replacement = std::mem::take(pending_inserts);
        // First deleted line gets the replacement
        ops.push(EditOp::Replaced {
            base_idx: first_del,
            lines: replacement,
        });
        // Remaining deleted lines are just deletes
        for &del_idx in &pending_deletes[1..] {
            ops.push(EditOp::Deleted { base_idx: del_idx });
        }
        pending_deletes.clear();
    } else if !pending_deletes.is_empty() {
        for &del_idx in pending_deletes.iter() {
            ops.push(EditOp::Deleted { base_idx: del_idx });
        }
        pending_deletes.clear();
    } else if !pending_inserts.is_empty() {
        ops.push(EditOp::Insert {
            before_base_idx: next_base_idx,
            lines: std::mem::take(pending_inserts),
        });
    }
}

/// Get any insertions before `base_idx` from the edit list.
fn get_insert_at(edits: &[EditOp], edit_idx: &mut usize, base_idx: usize) -> Vec<String> {
    let mut inserted = Vec::new();
    while *edit_idx < edits.len() {
        match &edits[*edit_idx] {
            EditOp::Insert {
                before_base_idx,
                lines,
            } if *before_base_idx == base_idx => {
                inserted.extend(lines.iter().cloned());
                *edit_idx += 1;
            }
            _ => break,
        }
    }
    inserted
}

/// Get the action for `base_idx` from the edit list.
fn get_action_at(edits: &[EditOp], edit_idx: &mut usize, base_idx: usize) -> Edit {
    if *edit_idx >= edits.len() {
        return Edit::Keep;
    }
    match &edits[*edit_idx] {
        EditOp::Kept { base_idx: bi } if *bi == base_idx => {
            *edit_idx += 1;
            Edit::Keep
        }
        EditOp::Deleted { base_idx: bi } if *bi == base_idx => {
            *edit_idx += 1;
            Edit::Delete
        }
        EditOp::Replaced {
            base_idx: bi,
            lines,
        } if *bi == base_idx => {
            let lines = lines.clone();
            *edit_idx += 1;
            Edit::Replace(lines)
        }
        _ => Edit::Keep,
    }
}

fn coalesce_hunks(hunks: Vec<Diff3Hunk>) -> Vec<Diff3Hunk> {
    let mut result: Vec<Diff3Hunk> = Vec::new();
    for hunk in hunks {
        let should_merge = matches!(
            (&hunk, result.last()),
            (Diff3Hunk::Stable(_), Some(Diff3Hunk::Stable(_)))
                | (Diff3Hunk::LeftChanged(_), Some(Diff3Hunk::LeftChanged(_)))
                | (Diff3Hunk::RightChanged(_), Some(Diff3Hunk::RightChanged(_)))
                | (Diff3Hunk::Conflict { .. }, Some(Diff3Hunk::Conflict { .. }))
        );
        if should_merge {
            match (result.last_mut().unwrap(), hunk) {
                (Diff3Hunk::Stable(existing), Diff3Hunk::Stable(new)) => existing.extend(new),
                (Diff3Hunk::LeftChanged(existing), Diff3Hunk::LeftChanged(new)) => {
                    existing.extend(new)
                }
                (Diff3Hunk::RightChanged(existing), Diff3Hunk::RightChanged(new)) => {
                    existing.extend(new)
                }
                (
                    Diff3Hunk::Conflict {
                        base: eb,
                        left: el,
                        right: er,
                    },
                    Diff3Hunk::Conflict {
                        base: nb,
                        left: nl,
                        right: nr,
                    },
                ) => {
                    eb.extend(nb);
                    el.extend(nl);
                    er.extend(nr);
                }
                _ => unreachable!(),
            }
        } else {
            result.push(hunk);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_conflict() {
        let base = "line1\nline2\nline3";
        let left = "line1\nmodified_left\nline3";
        let right = "line1\nline2\nline3_right";
        let scenario = MergeScenario::new(base, left, right);
        let result = diff3_merge(&scenario);
        assert!(result.is_resolved());
        if let MergeResult::Resolved(content) = &result {
            assert!(content.contains("modified_left"));
            assert!(content.contains("line3_right"));
        }
    }

    #[test]
    fn test_identical_changes() {
        let base = "line1\nline2";
        let left = "line1\nchanged";
        let right = "line1\nchanged";
        let scenario = MergeScenario::new(base, left, right);
        let result = diff3_merge(&scenario);
        assert!(result.is_resolved());
    }

    #[test]
    fn test_conflict_detection() {
        let base = "line1\noriginal\nline3";
        let left = "line1\nleft_change\nline3";
        let right = "line1\nright_change\nline3";
        let scenario = MergeScenario::new(base, left, right);
        let result = diff3_merge(&scenario);
        assert!(
            result.is_conflict(),
            "expected conflict but got: {:?}",
            result
        );
        if let MergeResult::Conflict { left, right, .. } = &result {
            assert!(left.contains("left_change"));
            assert!(right.contains("right_change"));
        }
    }

    #[test]
    fn test_multiple_conflicts() {
        let base = "a\nb\nc";
        let left = "x\nb\ny";
        let right = "p\nb\nq";
        let scenario = MergeScenario::new(base, left, right);
        let conflicts = extract_conflicts(&scenario);
        assert!(!conflicts.is_empty(), "should detect at least one conflict");
    }

    #[test]
    fn test_left_only_insert() {
        let base = "line1\nline3";
        let left = "line1\nline2\nline3";
        let right = "line1\nline3";
        let scenario = MergeScenario::new(base, left, right);
        let result = diff3_merge(&scenario);
        assert!(result.is_resolved());
        if let MergeResult::Resolved(content) = &result {
            assert!(content.contains("line2"));
        }
    }

    #[test]
    fn test_both_insert_different() {
        let base = "line1\nline3";
        let left = "line1\nleft_insert\nline3";
        let right = "line1\nright_insert\nline3";
        let scenario = MergeScenario::new(base, left, right);
        let result = diff3_merge(&scenario);
        // This should be a conflict since both inserted different content
        // at the same position
        assert!(
            result.is_conflict(),
            "expected conflict for different insertions at same position, got: {:?}",
            result
        );
    }

    #[test]
    fn test_delete_vs_modify_conflict() {
        let base = "keep\nmodify_me\nkeep_too";
        let left = "keep\nmodified_left\nkeep_too";
        let right = "keep\nkeep_too";
        let scenario = MergeScenario::new(base, left, right);
        let result = diff3_merge(&scenario);
        assert!(
            result.is_conflict(),
            "delete vs modify should conflict, got: {:?}",
            result
        );
    }
}
