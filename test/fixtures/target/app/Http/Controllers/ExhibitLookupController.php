<?php

namespace App\Http\Controllers;

use App\Models\ExhibitPage;

class ExhibitLookupController
{
    public function show(string $slug)
    {
        // Synthetic hazard: editable display_slug is used as a stable key.
        $page = ExhibitPage::where('display_slug', $slug)->firstOrFail();
        return view('exhibits.show', ['page' => $page]);
    }

    public function label(ExhibitPage $page)
    {
        // A display value is fine nowhere near a lookup call.
        return "Exhibit {$page->display_slug}";
    }
}
