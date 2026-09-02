<?php

namespace App\Services;

use App\Models\InventoryUnit;

/**
 * Fixture: two anonymous classes in one file, both defining a method of
 * the same name. Laravel 11 migrations are exactly this shape
 * (`return new class extends Migration { ... }`); this file proves what
 * happens when two of them, or two anonymous classes anywhere, collide
 * on a method name. There is no `class` param that can ever disambiguate
 * this -- anonymous classes have no name -- so it must stay unresolvable
 * regardless of config.
 */
function buildAnonymousProcessors(): array
{
    $a = new class {
        public function process($unitId)
        {
            InventoryUnit::delete($unitId);
        }
    };

    $b = new class {
        public function process($unitId)
        {
            InventoryUnit::delete($unitId);
        }
    };

    return [$a, $b];
}
