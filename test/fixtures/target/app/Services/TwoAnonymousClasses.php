<?php

namespace App\Services;

use App\Support\PreviewCache;

/**
 * Fixture: two anonymous classes in one file, both defining a method of
 * the same name. Anonymous helper objects can have this shape; this file
 * proves what happens when two of them collide
 * on a method name. There is no `class` param that can ever disambiguate
 * this -- anonymous classes have no name -- so it must stay unresolvable
 * regardless of config.
 */
function buildAnonymousProcessors(): array
{
    $a = new class {
        public function process($pageId)
        {
            PreviewCache::flush($pageId);
        }
    };

    $b = new class {
        public function process($pageId)
        {
            PreviewCache::flush($pageId);
        }
    };

    return [$a, $b];
}
