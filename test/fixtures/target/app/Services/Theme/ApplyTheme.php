<?php

namespace App\Services\Theme;

use App\Support\MuseumTheme;

class ApplyTheme
{
    public function activateScheduledPalette(string $palette): void
    {
        MuseumTheme::activate($palette);
    }
}
