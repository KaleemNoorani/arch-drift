<?php

namespace App\Services;

use App\Support\MuseumTheme;

class ExhibitEditor
{
    public function preview(string $palette): void
    {
        // Synthetic violation: an editor preview changes the active site theme.
        MuseumTheme::activate($palette);
    }

    public function overridePreview(string $palette): void
    {
        // A second forbidden pattern exercises the same file-wide checker.
        MuseumTheme::forceActivate($palette);
    }
}
