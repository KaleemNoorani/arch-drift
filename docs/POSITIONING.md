# Positioning

arch-drift isn't the first tool aimed at architectural drift, and it isn't
trying to be. The adjacent landscape includes at least three distinct
approaches:

- Tools that detect architectural erosion statistically, from signals in
  the codebase (churn, coupling, dependency-graph shape) with no
  user-authored configuration at all — architecture is inferred from
  behavior, not declared.
- Tools that model the intended architecture formally (components, layers,
  allowed relationships) and diff incoming changes against that model —
  architecture-as-code, checked structurally rather than lexically.
- Tools that learn an architectural baseline directly from the current
  state of a repository and flag PRs that deviate from what they've
  learned — the baseline itself is inferred, not authored.

All three infer structure, or detect divergence from a structure they
inferred. arch-drift starts from a different premise: some architectural
decisions exist only because a human made them, not because the codebase
implies them — a boundary drawn on purpose, a rule adopted for a stated
reason, a fact declared true. No amount of structural inference recovers a
decision that isn't visible in the code's current shape; the only way an
agent (or a person) reliably knows it is if it was written down and
checked, not rediscovered. That's the actual difference: preserving
declared intent across a long, agent-assisted build, rather than
discovering or scoring structure.

**The checker is the enforcement half of a three-part contract.** A human
authors the **Decision**; a deterministic check provides the
**Enforcement** for whatever part of it is mechanizable; and `knowledge[]`
carries the **Context** an agent needs to know but can't prove from code.
arch-drift is built to be exactly the middle third — nothing more.

