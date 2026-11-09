<?php

namespace App\Services;

use App\Support\PreviewCache;

class PreviewCacheService
{
    /** Build a display-only draft preview for the fictional museum site. */
    public function renderPreview(int $pageId): string
    {
        $page = $this->drafts->find($pageId);
        $title = $page->title;

        // A brace in a string must not end this method early.
        $note = "display marker } is ordinary text";

        // The nested closure still belongs to renderPreview.
        collect([$pageId])->each(function ($id) {
            PreviewCache::forPage($id)->flush();
        });

        // Matching text in comments is inert: PreviewCache::flush($pageId);
        # PreviewCache::flush($pageId) is inert here too.
        /*
         * PreviewCache::flush($pageId) is also inert in a block comment.
         */

        $literal = "PreviewCache::flush($pageId) is only a string";

        $help = <<<HELP
        Cache reset instructions mention PreviewCache::flush() and { braces.
        HELP;

        $example = <<<'EXAMPLE'
        PreviewCache::flush() is documentation, not a PHP call.
        EXAMPLE;

        // This executable call is the second intended finding.
        PreviewCache::flush($pageId);

        return $title;
    }

    /** The administrator's explicit reset path is outside the preview method. */
    public function resetPreviewCache(int $pageId): void
    {
        collect([$pageId])->each(function ($id) {
            PreviewCache::forPage($id)->flush();
        });

        PreviewCache::flush($pageId);
    }
}
