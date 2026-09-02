<?php

namespace App\Services;

use App\Models\InventoryUnit;

/**
 * Fixture proving three things at once, deliberately in one file since
 * they interact:
 *  - a `::class` constant reference (everywhere in Laravel) must not be
 *    mistaken for a class declaration by the scanner;
 *  - the literal word "class" inside a comment or a string must not
 *    create a spurious class range either;
 *  - a class conditionally declared inside a function, nested inside
 *    another class's own method, is its own scope -- its same-named
 *    method must not merge with the outer class's, even though its text
 *    falls inside the outer class's braces.
 */
class OuterProcessor
{
    public function process(int $unitId): void
    {
        // Not a real class declaration: class Something {
        $note = "also not a real class declaration: class Something {";

        $modelClass = InventoryUnit::class;

        InventoryUnit::delete($unitId);
    }

    public function setupLocalHelper(): void
    {
        if (!class_exists('LocalHelper')) {
            class LocalHelper
            {
                public function process(int $unitId): void
                {
                    // A different, unrelated process() -- must not be
                    // attributed to OuterProcessor.
                    InventoryUnit::delete($unitId);
                }
            }
        }
    }
}
