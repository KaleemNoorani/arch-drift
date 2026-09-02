<?php

namespace App\Services;

use App\Models\InventoryUnit;

class InventoryServiceBroken
{
    /**
     * Fixture: an unterminated heredoc makes this method's boundary
     * genuinely unresolvable. The scanner must report this file as
     * unresolvable and produce no finding here, never a violation --
     * even though a forbidden call is textually present below.
     */
    public function moveUnit(int $unitId, string $newLocation): void
    {
        $sql = <<<SQL
        SELECT * FROM inventory_units WHERE id = {$unitId}

        InventoryUnit::delete($unitId);
    }
}
