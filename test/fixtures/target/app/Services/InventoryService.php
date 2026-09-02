<?php

namespace App\Services;

use App\Models\InventoryUnit;

class InventoryService
{
    /**
     * A full-quantity move updates the SAME row's location in place; a
     * partial move decrements the source and creates a linked child row
     * instead. A hard delete here breaks the audit trail's lineage.
     */
    public function moveUnit(int $unitId, string $newLocation): void
    {
        $unit = InventoryUnit::find($unitId);
        $unit->location = $newLocation;
        $unit->save();

        // A brace inside a string must not desync the scanner.
        $note = "unexpected } here, not a real block";

        // Forbidden call inside a closure nested in the forbidden method -> violation.
        collect([$unitId])->each(function ($id) {
            InventoryUnit::where('id', $id)->delete();
        });

        // Same literal text inside a line comment must not match: InventoryUnit::delete($unitId);
        # Same literal text inside a hash comment must not match: InventoryUnit::delete($unitId);
        /*
         * Same literal text inside a block comment must not match:
         * InventoryUnit::delete($unitId);
         */

        // The literal call text inside a string must not match.
        $label = "would call InventoryUnit::delete() here, but this is just a string";

        // Inside a heredoc body must not match, including its own stray brace.
        $sql = <<<SQL
        -- InventoryUnit::delete() mentioned here is heredoc text, brace: { not real
        SELECT * FROM inventory_units WHERE id = {$unitId}
        SQL;

        // Inside a nowdoc body must not match.
        $note2 = <<<'NOWDOC'
        InventoryUnit::delete() mentioned here is nowdoc text, brace: {
        NOWDOC;

        // The real, direct forbidden call -> violation.
        InventoryUnit::delete($unitId);
    }

    /**
     * Voiding a receipt that was a mistake is explicitly documented as
     * destructive, and gated by a real safety check elsewhere. A legitimate
     * reason to delete from the same table, in the same file.
     */
    public function voidReceipt(int $unitId): void
    {
        // Forbidden call inside a closure nested in an ALLOWED method -> clean.
        collect([$unitId])->each(function ($id) {
            InventoryUnit::where('id', $id)->delete();
        });

        // Same call, allowed method, same file -> clean.
        InventoryUnit::delete($unitId);
    }
}
