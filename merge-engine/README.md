# merge-engine

A non-LLM merge conflict resolver that uses program analysis techniques from
recent academic research to automatically resolve git merge conflicts.

## How it works

The engine applies a pipeline of increasingly sophisticated strategies:

1. **Pattern-based DSL rules** — Matches common conflict patterns (whitespace-only, identical changes, import unions, adjacent edits) and resolves them instantly with high confidence. Based on [Svyatkovskiy et al., ICSE 2021](https://dl.acm.org/doi/10.1109/ICSE43902.2021.00055).

2. **Structured merge via tree-sitter CSTs** — Parses code into concrete syntax trees and performs three-way tree amalgamation, eliminating false conflicts from formatting changes or reordering. Based on [LASTMERGE, arXiv 2025](https://arxiv.org/abs/2501.00544).

3. **Version Space Algebra (VSA)** — For remaining conflicts, builds a compact representation of all possible resolutions by combining edits from both sides, then enumerates and ranks candidates. Based on [Zhu & He, OOPSLA 2018](https://dl.acm.org/doi/10.1145/3276536).

4. **Search-based resolution** — Uses evolutionary search (genetic algorithm) over candidate resolutions, scored by a fitness function measuring token-level similarity to both parents. Based on [Campos Junior et al., ACM TOSEM 2025](https://dl.acm.org/doi/10.1145/3710463).

## Supported languages

Tree-sitter-based structured merge: **Rust**, **JavaScript**, **TypeScript**, **Python**, **Java**, **Go**, **C**, **C++**, **Kotlin**, **TOML**, **YAML**

Pattern-based and search-based strategies work on any text content.

## Installation

```sh
cargo install merge-engine
```

Or build from source:

```sh
git clone https://github.com/maceip/merge-engine.git
cd merge-engine
cargo build --release
```

## Usage

### As a git custom merge driver

Add to your `.gitconfig`:

```gitconfig
[merge "merge-engine"]
    name = merge-engine structured merge driver
    driver = merge-engine %O %A %B %P
```

Add to `.gitattributes` in your repo:

```gitattributes
*.rs merge=merge-engine
*.kt merge=merge-engine
*.ts merge=merge-engine
*.py merge=merge-engine
```

### CLI

```sh
# Resolve conflict from three files
merge-engine base.rs left.rs right.rs path.rs

# Dry-run: report conflicts without modifying files
merge-engine --check base.rs left.rs right.rs

# Read conflict markers from stdin
cat conflicted_file.rs | merge-engine --stdin
```

### As a library

```rust
use merge_engine::{Resolver, ResolverConfig, Language};

let config = ResolverConfig {
    language: Some(Language::Rust),
    ..Default::default()
};
let resolver = Resolver::new(config);

let result = resolver.resolve_file(
    "fn main() { println!(\"hello\"); }",
    "fn main() { println!(\"hello world\"); }",
    "fn main() { println!(\"hello\"); eprintln!(\"debug\"); }",
);

println!("All resolved: {}", result.all_resolved);
println!("Merged:\n{}", result.merged_content);
```

## Architecture

```
src/
├── lib.rs           Module exports + public API re-exports
├── main.rs          CLI binary (git merge driver)
├── types.rs         Core types: CstNode, MergeResult, Language, Confidence
├── resolver.rs      Main orchestrator — 4-stage pipeline
├── diff3.rs         Baseline 3-way text merge
├── parser.rs        Tree-sitter CST parsing
├── patterns.rs      7 DSL pattern rules
├── matcher.rs       Yang + Hungarian matching algorithms
├── amalgamator.rs   3-way tree merge
├── vsa.rs           Version Space Algebra
└── search.rs        Search-based resolution
```

## License

MIT
