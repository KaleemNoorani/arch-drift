<?php

namespace App\Services\Legacy;

use App\Support\MuseumTheme;

class DemoThemeSeeder
{
    public function prepareDemo(string $palette): void
    {
        MuseumTheme::activate($palette);
    }
}
