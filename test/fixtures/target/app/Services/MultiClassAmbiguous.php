<?php

namespace App\Services;

use App\Models\InventoryUnit;

/**
 * Fixture: two unrelated classes in one file, each with their own
 * legitimate reason to define a same-named method. Neither is a PHP
 * fatal error -- this is routine, valid PHP. Proves the checker can
 * disambiguate via an optional `class` param instead of refusing to
 * scan the file at all.
 */
class PrimaryProcessor
{
    public function process(int $unitId): void
    {
        InventoryUnit::delete($unitId);
    }
}

class SecondaryProcessor
{
    public function process(int $unitId): void
    {
        InventoryUnit::delete($unitId);
    }
}
