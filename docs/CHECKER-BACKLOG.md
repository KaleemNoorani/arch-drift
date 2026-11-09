# Checker backlog

These are independently designed, hypothetical examples for a fictional
community-museum website. They illustrate checker capabilities that Arch-Drift
does not yet provide. They are design sketches, not observations from another
codebase. The existing `method_body_forbids` checker is already implemented;
the other proposed checks below are not.

## 1. Method-scoped patterns

`method_body_forbids` can inspect one named PHP method. In the hypothetical
site, `renderPreview` must not invalidate a shared page cache, while an
administrator's `resetPreviewCache` method may do so. A file-wide
`forbidden_call` cannot distinguish those methods. A fixture can put both
calls in one file and assert that only the call in `renderPreview` is reported.

```json
{
  "type": "method_body_forbids",
  "method": "renderPreview",
  "patterns": ["PreviewCache::flush(", "->flush()"],
  "scope": ["app/Services/PreviewCacheService.php"]
}
```

The current PHP scanner masks comments, strings, heredocs, and nowdocs. When
it cannot resolve a method boundary, it reports the file as unresolvable
instead of claiming a clean result. Class disambiguation is available through
the optional `class` parameter. These are implemented contracts, independent
of the hypothetical cache rule.

The complementary **unimplemented** `method_body_contains` could require a
named method to include a specified call. For example, a fictional exhibit
editor might require `publishDraft` to record a publication event:

```json
{
  "type": "method_body_contains",
  "method": "publishDraft",
  "requires_any": ["PublicationLog::record("],
  "scope": ["app/Services/ExhibitEditor.php"]
}
```

Textual presence alone would not prove that the call executes on every path.
The checker would need an explicit, narrow contract before implementation.

## 2. Declaration ordering (`route_order`)

In a fictional catalog, a literal route such as `/exhibits/by-slug/{slug}`
must precede `/exhibits/{id}` if the router resolves them in declaration
order. Existing checkers can find text in a file but do not compare the order
of two declarations. A proposed checker would report a parameter route that
precedes a conflicting literal sibling. It would need to define which router
syntax it understands and report unsupported syntax as unresolved.

## 3. Argument-position checks (`arg_position`)

Imagine a fictional drawing helper
`drawLabel(canvas, text, style, bounds)`. Swapping `style` and `bounds` could
be syntactically valid but produce the wrong image. A lexical proximity check
can find `drawLabel(`, but it cannot safely identify nested positional
arguments. A future checker would need a parser for its supported language
and a way to report ambiguity instead of guessing.

## Scope boundaries

Cross-file symbol-set parity and the meaning of a rendered value are separate
problems. A declaration-order or argument-position checker would not prove
those properties. Schema constraints such as uniqueness scope require
understanding declarations, and an interactive action's commit boundary
requires a behavioral test rather than source-text matching. Any future
proposal needs a fresh, synthetic fixture that demonstrates both a valid and
an invalid case before it becomes a rule.
