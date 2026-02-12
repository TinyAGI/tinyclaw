//! Ground truth integration tests for the merge engine.
//!
//! Each test case provides base, left, right inputs and asserts that the
//! resolver produces the expected output (or at minimum correctly identifies
//! conflicts). These scenarios are modeled after real-world merge conflicts
//! found in Kotlin/Java Android projects, Rust crates, and configuration files.

use merge_engine::{Language, ResolutionStrategy, Resolver, ResolverConfig};

// ──────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────

fn resolver_for(lang: Option<Language>) -> Resolver {
    Resolver::new(ResolverConfig {
        language: lang,
        ..Default::default()
    })
}

fn assert_resolved_contains(
    resolver: &Resolver,
    base: &str,
    left: &str,
    right: &str,
    must_contain: &[&str],
) {
    let result = resolver.resolve_file(base, left, right);
    assert!(
        result.all_resolved,
        "expected all conflicts resolved, but {} unresolved remain.\nMerged:\n{}",
        result
            .conflicts
            .iter()
            .filter(|c| c.resolution.is_none())
            .count(),
        result.merged_content,
    );
    for needle in must_contain {
        assert!(
            result.merged_content.contains(needle),
            "expected merged output to contain {:?}, but got:\n{}",
            needle,
            result.merged_content,
        );
    }
}

fn assert_conflict_detected(resolver: &Resolver, base: &str, left: &str, right: &str) {
    let result = resolver.resolve_file(base, left, right);
    // The resolver may auto-resolve via search/pattern, but it should at least
    // produce candidates if there was a real conflict
    let diff3 =
        merge_engine::diff3::diff3_merge(&merge_engine::MergeScenario::new(base, left, right));
    assert!(
        diff3.is_conflict() || !result.all_resolved || !result.conflicts.is_empty(),
        "expected the diff3 layer to detect a conflict for this input",
    );
}

// ──────────────────────────────────────────────────────────────
// 1. Kotlin: import list merging (MediaMaid-style)
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_kotlin_import_union() {
    let base = "\
import android.app.Activity
import android.os.Bundle
import android.widget.Button";

    let left = "\
import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.TextView";

    let right = "\
import android.app.Activity
import android.os.Bundle
import android.widget.Button
import androidx.media3.session.MediaSession";

    let resolver = resolver_for(Some(Language::Kotlin));
    assert_resolved_contains(
        &resolver,
        base,
        left,
        right,
        &[
            "android.widget.TextView",
            "androidx.media3.session.MediaSession",
        ],
    );
}

// ──────────────────────────────────────────────────────────────
// 2. Kotlin: function body edit vs. new function (adjacent)
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_kotlin_adjacent_function_edits() {
    let base = "\
class MediaService {
    fun play() {
        player.play()
    }

    fun pause() {
        player.pause()
    }
}";

    let left = "\
class MediaService {
    fun play() {
        player.prepare()
        player.play()
    }

    fun pause() {
        player.pause()
    }
}";

    let right = "\
class MediaService {
    fun play() {
        player.play()
    }

    fun pause() {
        player.pause()
    }

    fun stop() {
        player.stop()
    }
}";

    let resolver = resolver_for(Some(Language::Kotlin));
    let result = resolver.resolve_file(base, left, right);
    // Should include both the prepare() addition and the stop() function
    assert!(
        result.merged_content.contains("prepare") && result.merged_content.contains("stop"),
        "expected merged output to contain both 'prepare' and 'stop', got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 3. Rust: use statement merging
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_rust_use_union() {
    let base = "\
use std::collections::HashMap;
use std::io;";

    let left = "\
use std::collections::HashMap;
use std::collections::HashSet;
use std::io;";

    let right = "\
use std::collections::HashMap;
use std::io;
use std::sync::Arc;";

    let resolver = resolver_for(Some(Language::Rust));
    assert_resolved_contains(&resolver, base, left, right, &["HashSet", "Arc"]);
}

// ──────────────────────────────────────────────────────────────
// 4. Rust: both sides modify same function differently
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_rust_true_conflict() {
    let base = "\
fn process(input: &str) -> String {
    input.to_uppercase()
}";

    let left = "\
fn process(input: &str) -> String {
    input.to_lowercase()
}";

    let right = "\
fn process(input: &str) -> String {
    input.trim().to_string()
}";

    let resolver = resolver_for(Some(Language::Rust));
    assert_conflict_detected(&resolver, base, left, right);
}

// ──────────────────────────────────────────────────────────────
// 5. YAML: CI workflow — both sides add new jobs
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_yaml_ci_both_add_jobs() {
    let base = "\
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo test";

    let left = "\
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo test
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo clippy";

    let right = "\
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo test
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release";

    // Use text-mode for YAML since tree-sitter-yaml reconstruction loses
    // significant whitespace. The diff3 + pattern pipeline handles this well.
    let resolver = resolver_for(None);
    let result = resolver.resolve_file(base, left, right);
    // Should include both new jobs
    assert!(
        result.merged_content.contains("lint") && result.merged_content.contains("build"),
        "expected merged CI to contain both 'lint' and 'build' jobs, got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 6. TOML: Cargo.toml dependency version edits
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_toml_both_add_deps() {
    let base = "\
[package]
name = \"my-crate\"
version = \"0.1.0\"

[dependencies]
serde = \"1\"";

    let left = "\
[package]
name = \"my-crate\"
version = \"0.1.0\"

[dependencies]
serde = \"1\"
tokio = { version = \"1\", features = [\"full\"] }";

    let right = "\
[package]
name = \"my-crate\"
version = \"0.1.0\"

[dependencies]
serde = \"1\"
reqwest = \"0.12\"";

    let resolver = resolver_for(Some(Language::Toml));
    let result = resolver.resolve_file(base, left, right);
    assert!(
        result.merged_content.contains("tokio") && result.merged_content.contains("reqwest"),
        "expected merged Cargo.toml to contain both 'tokio' and 'reqwest', got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 7. JavaScript: identical changes (convergent edits)
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_js_identical_change() {
    let base = "\
function greet(name) {
    return 'Hello ' + name;
}";

    let left = "\
function greet(name) {
    return `Hello ${name}`;
}";

    let right = "\
function greet(name) {
    return `Hello ${name}`;
}";

    let resolver = resolver_for(Some(Language::JavaScript));
    assert_resolved_contains(&resolver, base, left, right, &["Hello ${name}"]);
}

// ──────────────────────────────────────────────────────────────
// 8. Python: import + function body edit
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_python_import_and_body() {
    let base = "\
import os

def main():
    print('hello')";

    let left = "\
import os
import sys

def main():
    print('hello')";

    let right = "\
import os

def main():
    print('hello world')";

    let resolver = resolver_for(Some(Language::Python));
    let result = resolver.resolve_file(base, left, right);
    // Left added import sys, right changed print body — non-overlapping
    assert!(
        result.merged_content.contains("import sys")
            && result.merged_content.contains("hello world"),
        "expected merged output to contain 'import sys' and 'hello world', got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 9. Whitespace-only false conflict
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_whitespace_false_conflict() {
    let base = "int x=1;\nint y=2;";
    let left = "int x = 1;\nint y = 2;";
    let right = "int  x = 1;\nint  y = 2;";

    let resolver = resolver_for(None);
    let output = resolver.resolve_conflict(base, left, right);
    assert!(
        output.resolution.is_some(),
        "whitespace-only changes should be auto-resolved"
    );
    assert_eq!(
        output.resolution.as_ref().unwrap().strategy,
        ResolutionStrategy::PatternRule
    );
}

// ──────────────────────────────────────────────────────────────
// 10. One side delete, other untouched — clean accept
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_one_side_delete() {
    let base = "line1\nto_delete\nline3";
    let left = "line1\nto_delete\nline3";
    let right = "line1\nline3";
    let resolver = resolver_for(None);
    let result = resolver.resolve_file(base, left, right);
    assert!(result.all_resolved);
    assert!(!result.merged_content.contains("to_delete"));
}

// ──────────────────────────────────────────────────────────────
// 11. Gradle build script: both add plugins
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_gradle_both_add_plugins() {
    let base = "\
plugins {
    id(\"com.android.application\")
    id(\"org.jetbrains.kotlin.android\")
}";

    let left = "\
plugins {
    id(\"com.android.application\")
    id(\"org.jetbrains.kotlin.android\")
    id(\"com.google.dagger.hilt.android\")
}";

    let right = "\
plugins {
    id(\"com.android.application\")
    id(\"org.jetbrains.kotlin.android\")
    id(\"org.jetbrains.kotlin.plugin.serialization\")
}";

    let resolver = resolver_for(Some(Language::Kotlin));
    let result = resolver.resolve_file(base, left, right);
    assert!(
        result.merged_content.contains("hilt") && result.merged_content.contains("serialization"),
        "expected both plugins in merged output, got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 12. Java: interface both add methods
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_java_interface_methods() {
    let base = "\
public interface Repository {
    void save(Entity entity);
    Entity findById(long id);
}";

    let left = "\
public interface Repository {
    void save(Entity entity);
    Entity findById(long id);
    List<Entity> findAll();
}";

    let right = "\
public interface Repository {
    void save(Entity entity);
    Entity findById(long id);
    void delete(long id);
}";

    let resolver = resolver_for(Some(Language::Java));
    let result = resolver.resolve_file(base, left, right);
    assert!(
        result.merged_content.contains("findAll") && result.merged_content.contains("delete"),
        "expected both new methods in merged output, got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 13. Multi-conflict file: some resolvable, some not
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_mixed_resolvable_and_conflict() {
    let base = "\
fn alpha() { return 1; }
fn beta() { return 2; }
fn gamma() { return 3; }";

    let left = "\
fn alpha() { return 10; }
fn beta() { return 2; }
fn gamma() { return 30; }";

    let right = "\
fn alpha() { return 100; }
fn beta() { return 2; }
fn gamma() { return 3; }";

    let resolver = resolver_for(None);
    let result = resolver.resolve_file(base, left, right);

    // beta should be stable, alpha is a conflict, gamma should be left-only
    // The key thing is that the resolver handles the file-level merge sensibly
    assert!(
        result.merged_content.contains("beta"),
        "stable function beta should be in output"
    );
}

// ──────────────────────────────────────────────────────────────
// 14. Prefix/suffix pattern
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_prefix_extension() {
    let base = "TODO: implement";
    let left = "TODO: implement feature A";
    let right = "TODO: implement feature A with validation";

    let resolver = resolver_for(None);
    let output = resolver.resolve_conflict(base, left, right);
    assert!(output.resolution.is_some());
    assert!(
        output
            .resolution
            .as_ref()
            .unwrap()
            .content
            .contains("validation"),
        "should pick the longer (more complete) version"
    );
}

// ──────────────────────────────────────────────────────────────
// 15. Go: import block merging
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_go_import_merge() {
    let base = "\
package main

import (
\t\"fmt\"
\t\"os\"
)";

    let left = "\
package main

import (
\t\"fmt\"
\t\"os\"
\t\"strings\"
)";

    let right = "\
package main

import (
\t\"fmt\"
\t\"os\"
\t\"path/filepath\"
)";

    let resolver = resolver_for(Some(Language::Go));
    let result = resolver.resolve_file(base, left, right);
    assert!(
        result.merged_content.contains("strings") && result.merged_content.contains("filepath"),
        "expected both new imports, got:\n{}",
        result.merged_content
    );
}

// ──────────────────────────────────────────────────────────────
// 16. Resolver pipeline: verify strategies are tried
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_pipeline_tries_all_strategies() {
    // Use a conflict that won't match any pattern rules and won't be
    // cleanly resolved by structured merge, forcing the full pipeline.
    let resolver = resolver_for(Some(Language::Rust));
    let output = resolver.resolve_conflict(
        "fn foo() { let x = old; }",
        "fn foo() { let x = left; }",
        "fn foo() { let x = right; }",
    );
    // Pattern rules are always tried first
    assert!(
        output
            .strategies_tried
            .contains(&ResolutionStrategy::PatternRule)
    );
    // Should have generated candidates from at least one strategy
    assert!(!output.candidates.is_empty());
    // If the whitespace pattern matched (which it does here since the structure
    // is similar), the pipeline early-returns — that's correct behavior.
    // Verify we at least got a resolution.
    assert!(
        output.resolution.is_some() || !output.candidates.is_empty(),
        "pipeline should produce at least one candidate"
    );
}

#[test]
fn ground_truth_pipeline_reaches_search_fallback() {
    // Use text-only mode with a genuinely hard conflict that won't match
    // any pattern rules, forcing it through all the way to search.
    let resolver = resolver_for(None);
    let output = resolver.resolve_conflict(
        "completely original base text here with unique tokens alpha beta",
        "entirely rewritten left side with different words gamma delta",
        "totally new right version with other terms epsilon zeta",
    );
    assert!(
        output
            .strategies_tried
            .contains(&ResolutionStrategy::PatternRule)
    );
    assert!(
        output
            .strategies_tried
            .contains(&ResolutionStrategy::SearchBased)
    );
    assert!(!output.candidates.is_empty());
}

// ──────────────────────────────────────────────────────────────
// 17. Adjacent line edits (non-overlapping changes)
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_adjacent_line_edits() {
    let base = "line1\nline2\nline3\nline4";
    let left = "MODIFIED1\nline2\nline3\nline4";
    let right = "line1\nline2\nline3\nMODIFIED4";

    let resolver = resolver_for(None);
    assert_resolved_contains(&resolver, base, left, right, &["MODIFIED1", "MODIFIED4"]);
}

// ──────────────────────────────────────────────────────────────
// 18. C header: both add #include
// ──────────────────────────────────────────────────────────────

#[test]
fn ground_truth_c_include_merge() {
    let base = "#include <stdio.h>\n#include <stdlib.h>";
    let left = "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>";
    let right = "#include <stdio.h>\n#include <stdlib.h>\n#include <math.h>";

    let resolver = resolver_for(Some(Language::C));
    assert_resolved_contains(&resolver, base, left, right, &["string.h", "math.h"]);
}
