# PHP method scope (`method_body_forbids`)

How the PHP-only `method_body_forbids` checker bounds a method body, attributes
methods to classes, and fails safe. See the [checker reference](CHECKER-REFERENCE.md)
for the other checker types.

## `method_body_forbids`: method-scoped forbidden calls (PHP only)

Synthetic motivating case: a fictional community-museum site renders page
previews. Clearing its shared preview cache inside `renderPreview` would
invalidate other previews, while an administrator's `resetPreviewCache` may
clear it intentionally. Both methods live in one file. `forbidden_call` is
file-granular; `method_body_forbids` can distinguish them:

```json
{
  "type": "method_body_forbids",
  "method": "renderPreview",
  "patterns": ["PreviewCache::flush(", "->flush()"],
  "scope": ["app/Services/PreviewCacheService.php"]
}
```

It extracts the named method's body and searches only within it. Doing
that safely means recognizing PHP's string, `//`/`#`/`/* */` comment, and
heredoc/nowdoc literal shapes well enough to treat their contents as
opaque — a brace inside a string, or the pattern text itself inside a
comment, must never desync the boundary or produce a match. That
recognition is implemented as a hand-written lexical scanner
(`src/lib/phpMask.js`) — deliberately not a parser: it has no notion of
PHP expressions, control flow, or scoping, only of where PHP goes opaque.

**This is the one checker type that is PHP-only, not language-agnostic.**
A second language would need its own sibling scanner recognizing that
language's own opaque-region shapes (a JS template literal, a Python
triple-quoted string) — there's nothing to generalize, because those are
different lexical problems that happen to rhyme, not one problem with a
language parameter.

**Class attribution, and the optional `class` param.** A same-named method
appearing more than once in one file is not automatically a problem — two
unrelated classes in the same file legitimately having their own
`process()` is routine, valid PHP, not a duplicate declaration. The
scanner attributes every method match to its *innermost* enclosing
class/trait/interface/anonymous-class scope (so a class conditionally
declared inside a function, itself nested in another class's method, is
its own scope, not its outer class's, even though its text falls inside
the outer class's braces). When a method name resolves to more than one
distinct scope, an optional `class` param disambiguates:

```json
{ "type": "method_body_forbids", "method": "process", "class": "PrimaryProcessor", "patterns": [...], "scope": [...] }
```

If `class` names something that doesn't exist anywhere in the file — a
typo, a rename, config drift — that's **unresolvable, not a silent pass**:
a rule that names a class no longer in the file looks configured and
checks nothing, which is the same failure as a missing config, one layer
down. **Anonymous classes** (`new class { ... }` — every Laravel 11
migration is one) are their own scope but have no name, so they can never
be targeted by `class`; two anonymous classes in one file both defining
the same method name is **permanently** unresolvable, not a gap `class`
can close — there's nothing to name.

**Fail-safe, by design**: if a method's boundary can't be confidently
resolved — an unterminated string, comment, or heredoc anywhere in the
file; unbalanced braces before EOF; more than one method resolving to the
same class scope; a named `class` absent from the file; or two+ classes
each defining the method with no `class` param to pick one — the file is
never scanned for a violation. It's reported via `recordUnresolvable` into
`unresolvable[]` (see [STATIC-REPORT-CONTRACT.md](STATIC-REPORT-CONTRACT.md)) and the **Unresolvable** report
section, and skipped. A coverage hole is the acceptable outcome here; a
false violation is not.

`known_gap`: this is a hand-written scanner, not the reference PHP
implementation. Genuinely pathological input (nested heredocs with
unusual identifiers, PHP syntax this scanner doesn't yet recognize) may be
reported unresolvable more often than a real parser would need to. One
specific known gap: an anonymous class instantiated with constructor
arguments that themselves contain a brace (`new class(function () { ... })
extends Foo { ... }`) can misidentify the class's own opening brace —
an edge case worth naming rather than implying the scanner handles every
syntactically legal form. That's the traded-off cost of staying dependency-free and
language-scoped to exactly this one checker type; see the design
discussion in [drift-log.md](../drift-log.md) for why a parser dependency was
evaluated and not taken.

