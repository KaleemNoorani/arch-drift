<?php

namespace App\Services;

use App\Support\PreviewCache;

class PreviewCacheServiceBroken
{
    /** An unterminated heredoc must produce unresolvable, not a finding. */
    public function renderPreview(int $pageId): void
    {
        $help = <<<HELP
        This deliberately never closes its heredoc.

        PreviewCache::flush($pageId);
    }
}
