//! merge-engine CLI — a git custom merge driver and standalone conflict resolver.
//!
//! # Usage as git merge driver
//!
//! ```gitconfig
//! [merge "merge-engine"]
//!     name = merge-engine structured merge driver
//!     driver = merge-engine %O %A %B %P
//! ```
//!
//! # Standalone usage
//!
//! ```sh
//! merge-engine <base> <left> <right>             # resolve from files
//! merge-engine --stdin                            # read conflict markers from stdin
//! merge-engine --check <base> <left> <right>      # dry-run: report but don't write
//! ```

use std::io::{self, Read as _};
use std::process::ExitCode;

use merge_engine::{Language, Resolver, ResolverConfig};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("merge-engine v{}", env!("CARGO_PKG_VERSION"));
        eprintln!();
        eprintln!("Usage:");
        eprintln!("  merge-engine <base> <left> <right> [path]    Resolve conflict from files");
        eprintln!(
            "  merge-engine --stdin                          Read conflict markers from stdin"
        );
        eprintln!("  merge-engine --check <base> <left> <right>   Dry-run (report only)");
        eprintln!();
        eprintln!("Git merge driver:");
        eprintln!("  merge-engine %O %A %B %P");
        return ExitCode::from(1);
    }

    if args[1] == "--stdin" {
        return resolve_stdin();
    }

    let check_mode = args[1] == "--check";
    let file_args = if check_mode { &args[2..] } else { &args[1..] };

    if file_args.len() < 3 {
        eprintln!("Error: need at least 3 file arguments: <base> <left> <right>");
        return ExitCode::from(1);
    }

    let base_path = &file_args[0];
    let left_path = &file_args[1];
    let right_path = &file_args[2];
    let file_path = file_args.get(3).map(|s| s.as_str());

    let base = match std::fs::read_to_string(base_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error reading base file {}: {}", base_path, e);
            return ExitCode::from(2);
        }
    };
    let left = match std::fs::read_to_string(left_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error reading left file {}: {}", left_path, e);
            return ExitCode::from(2);
        }
    };
    let right = match std::fs::read_to_string(right_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error reading right file {}: {}", right_path, e);
            return ExitCode::from(2);
        }
    };

    // Detect language from file path
    let language = file_path.and_then(|p| p.rsplit('.').next().and_then(Language::from_extension));

    let config = ResolverConfig {
        language,
        ..Default::default()
    };
    let resolver = Resolver::new(config);
    let result = resolver.resolve_file(&base, &left, &right);

    if check_mode {
        if result.all_resolved {
            eprintln!(
                "All conflicts resolved ({} conflict regions)",
                result.conflicts.len()
            );
            println!("{}", result.merged_content);
            ExitCode::SUCCESS
        } else {
            let unresolved = result
                .conflicts
                .iter()
                .filter(|c| c.resolution.is_none())
                .count();
            eprintln!("{} conflict(s) remain unresolved", unresolved);
            println!("{}", result.merged_content);
            ExitCode::from(1)
        }
    } else {
        // Git merge driver mode: write result to left file (the working copy)
        if result.all_resolved {
            if let Err(e) = std::fs::write(left_path, &result.merged_content) {
                eprintln!("Error writing merged result to {}: {}", left_path, e);
                return ExitCode::from(2);
            }
            ExitCode::SUCCESS
        } else {
            // Write partial merge with conflict markers
            if let Err(e) = std::fs::write(left_path, &result.merged_content) {
                eprintln!("Error writing partial merge to {}: {}", left_path, e);
                return ExitCode::from(2);
            }
            ExitCode::from(1)
        }
    }
}

/// Read conflict markers from stdin and attempt to resolve.
fn resolve_stdin() -> ExitCode {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("Error reading stdin: {}", e);
        return ExitCode::from(2);
    }

    // Parse conflict markers
    let conflicts = parse_conflict_markers(&input);
    if conflicts.is_empty() {
        eprintln!("No conflict markers found in input");
        println!("{}", input);
        return ExitCode::SUCCESS;
    }

    let resolver = Resolver::new(ResolverConfig::default());
    let mut output = input.clone();
    let mut all_resolved = true;

    for (base, left, right, full_marker) in conflicts.iter().rev() {
        let result = resolver.resolve_conflict(base, left, right);
        if let Some(resolution) = &result.resolution {
            output = output.replace(full_marker, &resolution.content);
        } else {
            all_resolved = false;
        }
    }

    print!("{}", output);
    if all_resolved {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

/// Parse git conflict markers from text, returning (base, left, right, full_marker).
fn parse_conflict_markers(text: &str) -> Vec<(String, String, String, String)> {
    let mut conflicts = Vec::new();
    let lines = text.lines();
    let mut marker_lines = Vec::new();
    let mut state = MarkerState::None;
    let mut left_lines = Vec::new();
    let mut base_lines = Vec::new();
    let mut right_lines = Vec::new();

    for line in lines {
        match state {
            MarkerState::None => {
                if line.starts_with("<<<<<<<") {
                    state = MarkerState::Left;
                    marker_lines.push(line);
                    left_lines.clear();
                    base_lines.clear();
                    right_lines.clear();
                }
            }
            MarkerState::Left => {
                marker_lines.push(line);
                if line.starts_with("|||||||") {
                    state = MarkerState::Base;
                } else if line.starts_with("=======") {
                    state = MarkerState::Right;
                } else {
                    left_lines.push(line);
                }
            }
            MarkerState::Base => {
                marker_lines.push(line);
                if line.starts_with("=======") {
                    state = MarkerState::Right;
                } else {
                    base_lines.push(line);
                }
            }
            MarkerState::Right => {
                marker_lines.push(line);
                if line.starts_with(">>>>>>>") {
                    let full_marker = marker_lines.join("\n");
                    conflicts.push((
                        base_lines.join("\n"),
                        left_lines.join("\n"),
                        right_lines.join("\n"),
                        full_marker,
                    ));
                    marker_lines.clear();
                    state = MarkerState::None;
                } else {
                    right_lines.push(line);
                }
            }
        }
    }

    conflicts
}

enum MarkerState {
    None,
    Left,
    Base,
    Right,
}
