# Local perceptual media similarity

Issue #18 adds a local, rebuildable similarity layer over the authoritative media identity from #8. It is deliberately evidence-only: it never merges, deletes, relinks, renames or otherwise changes creator media or project references.

## Identity model

SwayForge keeps three concepts separate:

- **Exact duplicate** uses the authoritative SHA-256 content hash from #8. A matching hash is reported as `exact-duplicate` with method `sha256` and does not depend on a perceptual score.
- **Highly similar** means local perceptual evidence crossed the high-confidence threshold. It is not an exact-identity claim.
- **Related** means weaker local visual evidence crossed the related threshold. It is explicitly not a duplicate claim.

The current thresholds are 0.90 for `highly-similar` and 0.72 for `related`. Scores are evidence and should be shown with the category/explanation rather than presented as certainty.

## Fingerprint method and version

Method version: `perceptual-dhash-multisample-v1`.

Images use a 64-bit difference hash (dHash) over a bounded 9×8 grayscale representation. A full-frame hash and, where possible, an 80% centre-crop hash are generated. Comparing the best cross-variant hash makes modest crops more discoverable while still leaving the result as perceptual evidence rather than identity.

Videos use exactly three deterministic representative positions: 10%, 50% and 90% of duration. Each sampled frame is reduced to the same 64-bit dHash. Video similarity is the average same-position Hamming similarity across those bounded samples. The worker decodes only the requested representative frames; it does not scan every frame.

No face recognition, biometric identity, semantic embeddings, copyright matching or cloud recognition is used.

## Cache and invalidation

Derived fingerprints live below Electron `userData` at:

`cache/media-similarity/fingerprints.json`

The cache is rebuildable and schema-versioned. Fingerprints are keyed by **source SHA-256 + method version**, never filename. Before a new fingerprint is generated, the managed source is checked as a regular file and its size/SHA-256 are verified against the authoritative media record. A method-version/schema mismatch quarantines the old cache and starts a clean rebuildable cache. Removed media is pruned from derived state during similarity/rebuild activity; source media is never removed by cache cleanup.

Only the derived perceptual hashes, source content hash, media kind and method version are stored in the similarity cache. The cache is not diagnostics data and must not be exported as diagnostics.

## Candidate bounding

A request does not compare every item with every other item. Candidates are first constrained to the same media kind, then coarsely bounded by aspect ratio and (for video) duration. Candidates are deterministically ranked by coarse distance and at most 128 are perceptually compared for one request. The response exposes `candidatePoolSize`, `comparisonsPerformed` and `comparisonLimit` so scale behaviour is observable without exposing private paths.

No perceptual comparisons are run merely because the application launches. Opening the service loads the cache only. An explicit rebuild may regenerate fingerprints for the library, but it still performs no all-pairs similarity scan.

## Renderer contract

The preload exposes only typed operations:

- `findSimilarMedia(mediaId, options)`;
- `getMediaSimilarityStatus()`;
- `rebuildMediaSimilarity()`.

A result contains source/candidate media IDs, category, score, method/version and a short UI explanation such as `same-looking image` or `similar sampled frames`. Grouped and flat result forms are returned for simple consumers.

The response also reports `destructiveActions: false`. There is no delete/merge IPC in this feature. A future user-controlled integrity workflow must make any destructive decision explicitly.

## False-positive and false-negative limitations

dHash is intentionally small, deterministic and local. It can miss substantial crops, edits, overlays, colour-only differences or videos whose sampled positions diverge. It can also over-score simple/low-detail imagery. Thresholds are therefore conservative evidence rules, not truth labels. Filename equality is never similarity evidence.
